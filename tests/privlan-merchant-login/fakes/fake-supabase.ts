/**
 * 仅测试使用的 Supabase 客户端替身。
 * 目的：能在「某张表的某类操作」上注入瞬时失败，并记录每一次调用与写入，
 * 用于证明修复后的登录在 scope 构造失败时确实做到零写入。
 * 语义刻意保持粗糙：只实现被测代码用到的链式方法。
 */
type Filter = { kind: "eq" | "is" | "gt"; column: string; value: any };

export const dbState = {
  rows: {} as Record<string, Array<Record<string, any>>>,
  /** key = `${table}:${op}`，值 = 注入失败的剩余次数 */
  fail: {} as Record<string, number>,
  /** key 同上：覆盖注入的错误对象形状，用于测试错误分类与「决定性错误不重试」 */
  errors: {} as Record<string, any>,
  calls: [] as Array<{ table: string; op: string; columns: string; filters: string[]; values: any }>,
  written: {} as Record<string, Array<Record<string, any>>>,
};

export function resetDb() {
  dbState.calls.length = 0;
  dbState.fail = {};
  dbState.errors = {};
  dbState.written = {};
}

/**
 * Storage 替身：只实现被测代码用到的 download()。
 * 语义与真实私有桶对齐——命中返回字节，未命中返回 404 形状错误，
 * 另可整体注入基础设施失败以验证 503 分诊。
 */
export const storageState = {
  calls: [] as Array<{ bucket: string; key: string }>,
  objects: {} as Record<string, { bytes: Uint8Array; contentType: string }>,
  /** 非空表示「后端不可用」这一类非 404 失败 */
  fail: null as null | { statusCode?: string; code?: string; message: string },
  /** list() 调用记录：证明存在性检查确实发生在签发之前 */
  listCalls: [] as Array<{ bucket: string; prefix: string; search: string }>,
  /** 签发调用记录：证明 path 由服务端派生、upsert 固定 false */
  signCalls: [] as Array<{ bucket: string; path: string; upsert: unknown }>,
  /** 注入签发失败（形状与真实 StorageError 对齐） */
  signFail: null as null | { statusCode?: string; code?: string; message: string },
  /**
   * 真实 Supabase 是否在签发时预创建 storage.objects 行【未知】，
   * 故两种分支都必须可测：true=签发即落行，false=签发不落行。
   */
  signCreatesRow: false,
  /** 写入调用记录：证明 upload 只发生一次、path 由服务端派生、upsert 固定 false */
  uploadCalls: [] as Array<{ bucket: string; path: string; upsert: unknown; contentType: unknown; bytes: number }>,
  /** 注入写入失败（形状与真实 StorageError 对齐） */
  uploadFail: null as null | { statusCode?: string; code?: string; message: string },
};

export function resetStorage() {
  storageState.calls.length = 0;
  storageState.objects = {};
  storageState.fail = null;
  storageState.listCalls.length = 0;
  storageState.signCalls.length = 0;
  storageState.signFail = null;
  storageState.signCreatesRow = false;
  storageState.uploadCalls.length = 0;
  storageState.uploadFail = null;
}

function injectedError(key: string) {
  const left = dbState.fail[key] ?? 0;
  if (left <= 0) return null;
  dbState.fail[key] = left - 1;
  // 默认形状 = 传输层瞬时失败；可用 dbState.errors[key] 换成决定性错误形状
  // message 故意不含任何行数据、token、口令或 hash
  return dbState.errors[key] ?? { code: "FETCH_ERROR", message: "injected transient failure" };
}

function matches(row: Record<string, any>, filters: Filter[]): boolean {
  return filters.every(({ kind, column, value }) => {
    const cell = row[column];
    if (kind === "is") return value === null ? cell === null || cell === undefined : cell === value;
    if (kind === "gt") return new Date(cell).getTime() > new Date(value).getTime();
    return String(cell) === String(value);
  });
}

class Query {
  op = "select";
  columns = "";
  values: any = null;
  filters: Filter[] = [];
  orderCol: string | null = null;
  orderAsc = true;
  limitN: number | null = null;

  constructor(public table: string) {}

  select(cols?: string) {
    this.op = "select";
    this.columns = cols || "";
    return this;
  }
  insert(values: any) {
    this.op = "insert";
    this.values = values;
    return this;
  }
  update(values: any) {
    this.op = "update";
    this.values = values;
    return this;
  }
  eq(column: string, value: any) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  is(column: string, value: any) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }
  gt(column: string, value: any) {
    this.filters.push({ kind: "gt", column, value });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderCol = column;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }

  private execute(): { data: any; error: any } {
    const key = `${this.table}:${this.op}`;
    dbState.calls.push({
      table: this.table,
      op: this.op,
      columns: this.columns,
      filters: this.filters.map((f) => `${f.kind}(${f.column},${String(f.value)})`),
      values: this.values,
    });
    const error = injectedError(key);
    if (error) return { data: null, error };

    if (this.op === "insert") {
      (dbState.written[this.table] ||= []).push(this.values);
      return { data: null, error: null };
    }
    if (this.op === "update") {
      for (const row of dbState.rows[this.table] || []) {
        if (matches(row, this.filters)) Object.assign(row, this.values);
      }
      return { data: null, error: null };
    }

    let rows = (dbState.rows[this.table] || []).filter((r) => matches(r, this.filters));
    if (this.orderCol) {
      const col = this.orderCol;
      rows = rows.slice().sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return cmp * (this.orderAsc ? 1 : -1);
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    return { data: rows, error: null };
  }

  async maybeSingle() {
    const { data, error } = this.execute();
    return { data: error ? null : ((data as any[])?.[0] ?? null), error };
  }
  async single() {
    const { data, error } = this.execute();
    const rows = (data as any[]) || [];
    return { data: rows[0] ?? null, error: error ?? (rows.length === 1 ? null : { code: "PGRST116" }) };
  }
  /** 让 `await db.from(t).insert(v)` 直接拿到 { data, error } */
  then<T>(onFulfilled: (v: { data: any; error: any }) => T, onRejected?: (r: any) => T) {
    return Promise.resolve(this.execute()).then(onFulfilled, onRejected);
  }
}

export function createClient(_url: string, _key: string, _opts?: any) {
  return {
    from(table: string) {
      return new Query(table);
    },
    storage: {
      from(bucket: string) {
        return {
          /**
           * 被测代码只用到 download() / list() / createSignedUploadUrl() / upload()。
           * 刻意不实现 uploadToSignedUrl()：那是浏览器侧 API，服务端出现即测试炸。
           * upload() 复刻真实语义：已存在且 upsert!==true 时返回 409 形状错误，绝不静默覆盖。
           */
          async upload(
            path: string,
            body: ArrayBuffer | Uint8Array,
            options?: { contentType?: string; upsert?: boolean },
          ) {
            const bytes = body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer);
            storageState.uploadCalls.push({
              bucket,
              path,
              upsert: options?.upsert,
              contentType: options?.contentType,
              bytes: bytes.byteLength,
            });
            if (storageState.uploadFail) return { data: null, error: storageState.uploadFail };
            if (storageState.fail) return { data: null, error: storageState.fail };
            const fullKey = `${bucket}/${path}`;
            if (storageState.objects[fullKey] && options?.upsert !== true) {
              return { data: null, error: { statusCode: "409", message: "The resource already exists" } };
            }
            storageState.objects[fullKey] = {
              bytes,
              contentType: options?.contentType ?? "application/octet-stream",
            };
            return { data: { Key: path, Id: "synthetic-object-id", path }, error: null };
          },
          async download(key: string) {
            storageState.calls.push({ bucket, key });
            if (storageState.fail) return { data: null, error: storageState.fail };
            const object = storageState.objects[`${bucket}/${key}`];
            if (!object) return { data: null, error: { statusCode: "404", message: "Object not found" } };
            return { data: new Blob([object.bytes], { type: object.contentType }), error: null };
          },
          /** 只列直接子对象（name 不含分隔符），与真实 storage-api 语义对齐 */
          async list(prefix?: string, options?: { search?: string; limit?: number }) {
            const p = String(prefix ?? "").replace(/^\/+|\/+$/g, "");
            storageState.listCalls.push({ bucket, prefix: p, search: String(options?.search ?? "") });
            if (storageState.fail) return { data: null, error: storageState.fail };
            const base = p ? `${bucket}/${p}/` : `${bucket}/`;
            const rows = Object.keys(storageState.objects)
              .filter((k) => k.startsWith(base))
              .map((k) => ({ key: k, name: k.slice(base.length) }))
              .filter((r) => r.name.length > 0 && !r.name.includes("/"))
              .filter((r) => !options?.search || r.name.includes(String(options.search)))
              .map((r) => ({
                name: r.name,
                id: "synthetic-object-id",
                metadata: {
                  size: storageState.objects[r.key].bytes.byteLength,
                  mimetype: storageState.objects[r.key].contentType,
                },
              }));
            return { data: rows.slice(0, options?.limit ?? 100), error: null };
          },
          /** 只签发，绝不上传；token 是固定合成串，便于断言「它没有泄漏到任何出口」 */
          async createSignedUploadUrl(path: string, options?: { upsert?: boolean }) {
            storageState.signCalls.push({ bucket, path, upsert: options?.upsert });
            if (storageState.signFail) return { data: null, error: storageState.signFail };
            if (storageState.fail) return { data: null, error: storageState.fail };
            if (storageState.signCreatesRow) {
              storageState.objects[`${bucket}/${path}`] = {
                bytes: new Uint8Array(0),
                contentType: "application/octet-stream",
              };
            }
            const token = "synthetic-signed-upload-token-DO-NOT-LEAK";
            return {
              data: {
                signedUrl: `https://mock.invalid/storage/v1/object/upload/sign/${bucket}/${path}?token=***}`,
                path,
                token,
              },
              error: null,
            };
          },
        };
      },
    },
  };
}
