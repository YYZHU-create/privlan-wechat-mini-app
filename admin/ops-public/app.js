const { createApp, reactive, ref, computed, onMounted, onUnmounted } = Vue;

createApp({
  setup() {
    const session = ref(null);
    const loading = ref(true);
    const login = reactive({ email: "ops-admin@localhost", password: "", sending: false, error: "" });
    const requestedView = new URLSearchParams(location.search).get("view") || "overview";
    const data = reactive({ metrics: {}, tenants: [], plans: [], subscriptions: [], licenses: [], auditEvents: [] });
    const health = reactive({ status: "checking", database: "unknown", databaseKind: "", checkedAt: null });
    const appHealth = reactive({ status: "checking", checkedAt: null });
    const error = ref("");
    const notices = reactive([]);
    const licenseForm = reactive({ open: false, planId: "PRO", durationHours: 720, count: 10, channel: "", batchId: "", redeemDeadline: "", note: "", saving: false, error: "", generated: [] });
    const busy = ref("");
    const disableConfirm = ref(null);

    const nav = [
      { id: "overview", label: "概览", icon: "ph:gauge" },
      { id: "tenants", label: "租户", icon: "ph:buildings" },
      { id: "plans", label: "套餐", icon: "ph:wallet" },
      { id: "licenses", label: "兑换码", icon: "ph:ticket" },
      { id: "subscriptions", label: "订阅", icon: "ph:calendar-check" },
      { id: "audit", label: "审计", icon: "ph:list-magnifying-glass" },
      { id: "system", label: "系统", icon: "ph:heartbeat" }
    ];
    const view = ref(nav.some(item => item.id === requestedView) ? requestedView : "overview");
    const title = computed(() => nav.find(item => item.id === view.value)?.label || "运营后台");

    function notice(title, message, type = "success") {
      const item = { id: Date.now() + Math.random(), title, message, type };
      notices.push(item);
      setTimeout(() => { const index = notices.indexOf(item); if (index >= 0) notices.splice(index, 1); }, 4200);
    }

    async function api(url, options = {}) {
      const response = await fetch(url, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) { session.value = null; throw new Error(result.error || "运营会话已过期，请重新登录"); }
      if (!response.ok || !result.ok) throw new Error(result.error || result.message || `请求失败（${response.status}）`);
      return result.data;
    }

    async function checkSession() {
      try { session.value = await api("/ops/v1/auth/session"); if (session.value) await loadData(); }
      catch (err) { session.value = null; }
      finally { loading.value = false; }
    }

    async function signIn() {
      if (login.sending) return;
      login.error = ""; login.sending = true;
      try {
        session.value = await api("/ops/v1/auth/login", { method: "POST", body: JSON.stringify({ email: login.email, password: login.password }) });
        login.password = "";
        await loadData();
      } catch (err) { login.error = err.message; }
      finally { login.sending = false; }
    }

    async function signOut() {
      await fetch("/ops/v1/auth/logout", { method: "POST", credentials: "same-origin" });
      session.value = null;
    }

    async function loadApplicationHealth() {
      appHealth.status = "checking";
      try {
        const response = await fetch("/health", { credentials: "same-origin", cache: "no-store" });
        appHealth.status = response.ok ? "ok" : "error";
      } catch (err) {
        appHealth.status = "error";
      }
      appHealth.checkedAt = new Date().toISOString();
    }

    async function loadHealth() {
      health.status = "checking";
      try {
        const next = await api("/ops/v1/health");
        Object.assign(health, { status: next.database === "ok" ? "ok" : "error", ...next });
      } catch (err) {
        health.status = "error";
        health.database = "unavailable";
        health.checkedAt = new Date().toISOString();
      }
    }

    async function loadData() {
      error.value = "";
      try {
        const next = await api("/ops/v1/bootstrap");
        Object.keys(data).forEach(key => { data[key] = next[key] ?? data[key]; });
        await Promise.all([loadHealth(), loadApplicationHealth()]);
      } catch (err) { error.value = err.message; await Promise.all([loadHealth(), loadApplicationHealth()]); }
    }

    function switchView(id) {
      if (!nav.some(item => item.id === id)) id = "overview";
      view.value = id;
      const url = new URL(location.href); url.searchParams.set("view", id); history.replaceState({}, "", url);
    }

    function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
    function formatMoney(value) { return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(Number(value) || 0); }
    function formatDate(value) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
    function formatDuration(hours) {
      const value = Number(hours || 0);
      if (value >= 8760 && value % 8760 === 0) return `${value / 8760} 年`;
      if (value >= 24 && value % 24 === 0) return `${value / 24} 天`;
      return `${value} 小时`;
    }
    function statusLabel(value) { return ({ active: "正常", inactive: "未激活", expired: "已到期", trial: "试用", past_due: "欠费", suspended: "暂停", closed: "关闭", unused: "未兑换", partially_used: "部分使用", redeemed: "已兑换", disabled: "已禁用" })[value] || value || "未知"; }
    function entitlementLabel(key) { return ({ stores: "店铺数", skuLimit: "SKU 上限", storageGb: "存储空间（GB）", aiPoints: "AI 点数", sharedAppId: "共享 AppID", merchantAppId: "独立 AppID", aiWorkspace: "AI 工作区", feishu: "飞书集成", audit: "审计" })[key] || key; }
    function entitlementValue(value) { return typeof value === "boolean" ? (value ? "已包含" : "未包含") : formatNumber(value); }

    async function generateLicenses() {
      licenseForm.error = ""; licenseForm.saving = true;
      try { licenseForm.generated = await api("/ops/v1/license-codes", { method: "POST", body: JSON.stringify(licenseForm) }); await loadData(); notice("兑换码已生成", `本批次共 ${licenseForm.generated.length} 个，请立即保存完整兑换码。`); }
      catch (err) { licenseForm.error = err.message; }
      finally { licenseForm.saving = false; }
    }

    function disableLicense(item) { disableConfirm.value = item; }

    async function confirmDisableLicense() {
      const item = disableConfirm.value;
      if (!item || busy.value) return;
      busy.value = item.id;
      try { await api(`/ops/v1/license-codes/${encodeURIComponent(item.id)}/disable`, { method: "PATCH", body: "{}" }); disableConfirm.value = null; await loadData(); notice("兑换码已禁用", item.codeMasked); }
      catch (err) { notice("无法禁用兑换码", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function extendSubscription(subscription, days) {
      busy.value = subscription.workspaceId;
      try { await api(`/ops/v1/subscriptions/${encodeURIComponent(subscription.workspaceId)}/extend`, { method: "POST", body: JSON.stringify({ days }) }); await loadData(); notice("订阅已延长", `${subscription.tenantName} 延长 ${days} 天`); }
      catch (err) { notice("订阅延长失败", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function copyGeneratedCodes() {
      try { await navigator.clipboard.writeText(licenseForm.generated.map(item => item.code).join("\n")); notice("已复制", `${licenseForm.generated.length} 个兑换码已复制到剪贴板`); }
      catch (err) { notice("复制失败", "请手动选择并复制兑换码。", "error"); }
    }
    function csvCell(value) { const text = String(value ?? ""); return /^[=+\-@]/.test(text) ? `\t${text}` : text; }
    function downloadGeneratedCodes() {
      try {
        const rows = ["code,plan,durationHours", ...licenseForm.generated.map(item => [item.code, item.planId, item.durationHours].map(csvCell).join(","))];
        const url = URL.createObjectURL(new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = `feeldao-license-${Date.now()}.csv`; link.click(); URL.revokeObjectURL(url);
      } catch (err) { notice("下载失败", "请稍后重试。", "error"); }
    }

    function handleKeydown(event) {
      if (event.key !== "Escape") return;
      if (licenseForm.saving || busy.value) return;
      if (licenseForm.open) licenseForm.open = false;
      else disableConfirm.value = null;
    }

    onMounted(() => { checkSession(); window.addEventListener("keydown", handleKeydown); });
    onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
    return { session, loading, login, view, data, health, appHealth, error, notices, nav, title, licenseForm, disableConfirm, busy, signIn, signOut, loadData, switchView, formatNumber, formatMoney, formatDate, formatDuration, statusLabel, entitlementLabel, entitlementValue, generateLicenses, disableLicense, confirmDisableLicense, extendSubscription, copyGeneratedCodes, downloadGeneratedCodes };
  },
  template: `
    <div v-if="loading" class="ops-loading"><span class="ops-mark">F</span><p>正在验证运营会话…</p></div>
    <main v-else-if="!session" class="login-page">
      <section class="login-panel" aria-labelledby="login-title"><div class="login-brand"><span class="ops-mark">F</span><div><strong translate="no">Feeldao OS</strong><small>SAAS CONTROL PLANE</small></div></div><div class="login-copy"><span class="eyebrow">PRIVATE OPERATIONS</span><h1 id="login-title">平台运营后台</h1><p>管理租户、套餐、兑换码、订阅和平台审计。商户无法访问此处。</p></div><form @submit.prevent="signIn"><label for="ops-email">运营账号</label><input id="ops-email" v-model.trim="login.email" name="email" type="email" autocomplete="username" spellcheck="false" placeholder="name@company.com…"><label for="ops-password">密码</label><input id="ops-password" v-model="login.password" name="password" type="password" autocomplete="current-password" placeholder="输入运营后台密码…"><p v-if="login.error" class="form-error" role="alert">{{ login.error }}</p><button type="submit" :disabled="login.sending || !login.email || !login.password">{{ login.sending ? '正在验证…' : '进入运营后台' }}<iconify-icon icon="ph:arrow-right"></iconify-icon></button></form><footer><iconify-icon icon="ph:shield-check"></iconify-icon><span>独立会话 · 8 小时过期 · 关键操作留痕</span></footer></section><aside class="login-atmosphere" aria-hidden="true"><div class="instrument-lines"><i></i><i></i><i></i><i></i></div><div><span>01 / TENANCY</span><span>02 / SUBSCRIPTIONS</span><span>03 / LICENSES</span><span>04 / AUDIT</span></div></aside>
    </main>
    <div v-else class="ops-shell">
      <header class="ops-topbar"><div class="ops-brand"><span class="ops-mark">F</span><div><strong translate="no">Feeldao OS</strong><small>SAAS CONTROL PLANE</small></div></div><div class="ops-location"><span>平台运营</span><iconify-icon icon="ph:caret-right" aria-hidden="true"></iconify-icon><strong>{{ title }}</strong></div><div class="ops-actions"><button type="button" class="icon-btn" aria-label="刷新运营数据" @click="loadData"><iconify-icon icon="ph:arrows-clockwise"></iconify-icon></button><span class="operator"><span>{{ session.name.slice(0,1) }}</span><span><strong>{{ session.name }}</strong><small>{{ session.role }}</small></span></span><button type="button" class="btn" @click="signOut">退出</button></div></header>
      <div class="ops-body"><aside class="ops-sidebar"><nav aria-label="运营导航"><button v-for="item in nav" :key="item.id" type="button" :class="{active:view===item.id}" :aria-label="item.label" :aria-current="view===item.id?'page':null" @click="switchView(item.id)"><iconify-icon :icon="item.icon" aria-hidden="true"></iconify-icon><span>{{ item.label }}</span></button></nav><div class="ops-sidebar-foot"><span class="health-dot" :class="{error:health.status==='error'}"></span><span><strong>SaaS Control Plane</strong><small>PostgreSQL</small></span></div></aside>
        <main id="ops-main" class="ops-main" tabindex="-1"><div v-if="error" class="page-error" role="alert"><span>{{ error }}</span><button type="button" @click="loadData">重试</button></div>
          <section v-if="view==='overview'" class="ops-page"><header class="page-head"><div><span class="eyebrow">SYSTEM OVERVIEW</span><h1>平台运行概览</h1><p>只展示 PostgreSQL 中的真实租户、订阅、兑换码和审计记录。</p></div><span class="state-chip" :class="health.status==='ok'?'success':health.status==='error'?'danger':'warning'"><i></i>{{ health.status==='ok'?'数据库连接正常':health.status==='error'?'数据库连接异常':'正在检查数据库' }}</span></header><div class="metric-grid"><article><span>租户</span><strong>{{ formatNumber(data.metrics.tenants) }}</strong><small>{{ data.metrics.activeTenants || 0 }} 个正常 · {{ data.metrics.trials || 0 }} 个试用</small></article><article><span>有效订阅</span><strong>{{ data.subscriptions.filter(item=>item.status==='active').length }}</strong><small>来自 PostgreSQL 订阅记录</small></article><article><span>兑换码</span><strong>{{ data.licenses.length }}</strong><small>{{ data.licenses.filter(item=>item.status==='unused').length }} 个未兑换</small></article><article><span>审计记录</span><strong>{{ data.auditEvents.length }}</strong><small>最近 200 条真实操作记录</small></article></div><div class="overview-layout"><section class="panel"><header><div><span class="eyebrow">TENANT PULSE</span><h2>租户状态</h2></div><button type="button" class="text-btn" @click="switchView('tenants')">查看全部</button></header><div class="tenant-pulse"><div v-if="!data.tenants.length" class="empty-state compact"><p>暂无租户记录。</p></div><article v-for="tenant in data.tenants.slice(0,6)" :key="tenant.id"><span class="tenant-monogram">{{ tenant.name.slice(0,1) }}</span><span><strong>{{ tenant.name }}</strong><small>{{ tenant.workspaceName || tenant.id }}</small></span><span class="state-chip" :class="tenant.status==='active'?'success':'warning'">{{ statusLabel(tenant.status) }}</span></article></div></section><section class="panel"><header><div><span class="eyebrow">DATABASE STATUS</span><h2>数据源状态</h2></div></header><dl class="health-list"><div><dt>控制面数据源</dt><dd>PostgreSQL</dd></div><div><dt>连接状态</dt><dd :class="health.status==='error'?'danger':''"><i></i>{{ health.status==='ok'?'可用':'不可用' }}</dd></div><div><dt>数据库类型</dt><dd>{{ health.databaseKind || '—' }}</dd></div><div><dt>检查时间</dt><dd>{{ formatDate(health.checkedAt) }}</dd></div></dl></section></div></section>
          <section v-else-if="view==='tenants'" class="ops-page"><header class="page-head"><div><span class="eyebrow">TENANT DIRECTORY</span><h1>租户与工作区</h1><p>只读查看租户、工作区和订阅关系；状态与套餐不在此页面修改。</p></div></header><section class="panel table-panel"><table><thead><tr><th>租户</th><th>工作区</th><th>套餐</th><th>租户状态</th><th>订阅状态</th><th>到期时间</th></tr></thead><tbody><tr v-if="!data.tenants.length"><td colspan="6" class="empty-cell">暂无租户记录</td></tr><tr v-for="tenant in data.tenants" :key="tenant.id"><td><strong>{{ tenant.name }}</strong><small>{{ tenant.id }}</small></td><td><strong>{{ tenant.workspaceName || '未创建工作区' }}</strong><small>{{ tenant.workspaceId || '—' }}</small></td><td>{{ tenant.planId || '—' }}</td><td><span class="state-chip" :class="tenant.status==='active'?'success':'warning'">{{ statusLabel(tenant.status) }}</span></td><td><span class="state-chip" :class="tenant.subscriptionStatus==='active'?'success':'warning'">{{ statusLabel(tenant.subscriptionStatus) }}</span></td><td>{{ formatDate(tenant.expiresAt) }}</td></tr></tbody></table></section></section>
          <section v-else-if="view==='plans'" class="ops-page"><header class="page-head"><div><span class="eyebrow">PLAN CATALOG</span><h1>套餐与权益</h1><p>套餐定义来自 PostgreSQL plan_catalog，本页面仅供运营核对。</p></div></header><div class="plan-grid"><article v-for="plan in data.plans" :key="plan.id" class="panel plan-card"><header><div><span class="eyebrow">{{ plan.id }}</span><h2>{{ plan.name }}</h2></div><span class="state-chip" :class="plan.public?'success':''">{{ plan.public?'公开套餐':'内部套餐' }}</span></header><div class="plan-summary"><div><span>价格</span><strong>{{ formatMoney(plan.monthlyPrice) }}</strong></div><div><span>有效时长</span><strong>{{ formatDuration(plan.durationHours) }}</strong></div></div><dl class="entitlement-list"><div v-if="!Object.keys(plan.entitlements || {}).length"><dt>权益</dt><dd>暂无配置</dd></div><div v-for="(value,key) in plan.entitlements" :key="key"><dt>{{ entitlementLabel(key) }}</dt><dd>{{ entitlementValue(value) }}</dd></div></dl></article><div v-if="!data.plans.length" class="panel empty-state"><p>暂无套餐记录。</p></div></div></section>
          <section v-else-if="view==='licenses'" class="ops-page"><header class="page-head"><div><span class="eyebrow">LICENSE MANAGEMENT</span><h1>兑换码</h1><p>生成体验或 PRO 兑换码。完整兑换码只在创建结果中显示一次。</p></div><button type="button" class="btn primary" @click="licenseForm.open=true;licenseForm.generated=[]"><iconify-icon icon="ph:plus"></iconify-icon>生成兑换码</button></header><div class="metric-grid compact"><article><span>总计</span><strong>{{ data.licenses.length }}</strong></article><article><span>未兑换</span><strong>{{ data.licenses.filter(item=>item.status==='unused').length }}</strong></article><article><span>已兑换</span><strong>{{ data.licenses.filter(item=>item.status==='redeemed').length }}</strong></article><article><span>已禁用</span><strong>{{ data.licenses.filter(item=>item.status==='disabled').length }}</strong></article></div><section class="panel table-panel"><table><thead><tr><th>兑换码</th><th>类型</th><th>时长</th><th>状态</th><th>渠道 / 批次</th><th>生成时间</th><th>兑换信息</th><th>操作</th></tr></thead><tbody><tr v-if="!data.licenses.length"><td colspan="8" class="empty-cell">还没有兑换码</td></tr><tr v-for="item in data.licenses" :key="item.id"><td><code>{{ item.codeMasked }}</code></td><td>{{ item.planId }}</td><td>{{ formatDuration(item.durationHours) }}</td><td><span class="state-chip" :class="item.status==='redeemed'?'success':item.status==='disabled'?'danger':'warning'">{{ statusLabel(item.status) }}</span></td><td>{{ item.channel || '—' }}<small>{{ item.batchId || '无批次' }}</small></td><td>{{ formatDate(item.createdAt) }}</td><td>{{ item.workspaceId || '尚未兑换' }}<small>{{ formatDate(item.redeemedAt) }}</small></td><td><button v-if="item.status==='unused'" type="button" class="btn small" :disabled="busy===item.id" @click="disableLicense(item)">禁用</button></td></tr></tbody></table></section></section>
          <section v-else-if="view==='subscriptions'" class="ops-page"><header class="page-head"><div><span class="eyebrow">SUBSCRIPTION OPERATIONS</span><h1>商户订阅</h1><p>查看 PostgreSQL 订阅状态；人工续期会在同一事务中写入审计记录。</p></div></header><section class="panel table-panel subscription-table"><table><thead><tr><th>租户</th><th>工作区</th><th>套餐</th><th>状态</th><th>到期时间</th><th>续期</th></tr></thead><tbody><tr v-if="!data.subscriptions.length"><td colspan="6" class="empty-cell">暂无订阅记录</td></tr><tr v-for="item in data.subscriptions" :key="item.workspaceId"><td><strong>{{ item.tenantName }}</strong><small>{{ item.tenantId }}</small></td><td><strong>{{ item.workspaceName }}</strong><small>{{ item.workspaceId }}</small></td><td>{{ item.planId }}</td><td><span class="state-chip" :class="item.status==='active'?'success':'warning'">{{ statusLabel(item.status) }}</span></td><td>{{ formatDate(item.expiresAt) }}</td><td><div class="connection-buttons"><button class="btn small" :disabled="busy===item.workspaceId" @click="extendSubscription(item,1)">+1 天</button><button class="btn small" :disabled="busy===item.workspaceId" @click="extendSubscription(item,7)">+7 天</button><button class="btn small" :disabled="busy===item.workspaceId" @click="extendSubscription(item,30)">+30 天</button></div></td></tr></tbody></table></section></section>
          <section v-else-if="view==='audit'" class="ops-page"><header class="page-head"><div><span class="eyebrow">AUDIT TRAIL</span><h1>审计记录</h1><p>展示 PostgreSQL 中最近 200 条真实操作记录，不显示密码、Token 或完整兑换码。</p></div></header><section class="panel table-panel"><table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>资源</th><th>租户</th><th>编号</th></tr></thead><tbody><tr v-if="!data.auditEvents.length"><td colspan="6" class="empty-cell">暂无审计记录</td></tr><tr v-for="item in data.auditEvents" :key="item.id"><td>{{ formatDate(item.createdAt) }}</td><td>{{ item.actorId }}</td><td><strong>{{ item.action }}</strong></td><td>{{ item.resourceType }}<small>{{ item.resourceId || '—' }}</small></td><td>{{ item.tenantId || '平台' }}</td><td><code>{{ item.id }}</code></td></tr></tbody></table></section></section><section v-else-if="view==='system'" class="ops-page"><header class="page-head"><div><span class="eyebrow">SYSTEM STATUS</span><h1>系统状态</h1><p>仅展示当前运行时可安全读取的健康信号，不包含密钥、凭证或生产配置。</p></div><span class="state-chip" :class="appHealth.status==='ok' && health.status==='ok'?'success':appHealth.status==='error' || health.status==='error'?'danger':'warning'"><i></i>{{ appHealth.status==='ok' && health.status==='ok'?'运行正常':appHealth.status==='error' || health.status==='error'?'存在异常':'检查中' }}</span></header><div class="system-grid"><section class="panel"><header><div><span class="eyebrow">APPLICATION</span><h2>应用运行时</h2><p>由公开存活探针提供状态。</p></div><span class="state-chip" :class="appHealth.status==='ok'?'success':appHealth.status==='error'?'danger':'warning'"><i></i>{{ appHealth.status==='ok'?'可用':appHealth.status==='error'?'不可用':'检查中' }}</span></header><dl class="health-list"><div><dt>运行时信号</dt><dd>/health</dd></div><div><dt>最后检查</dt><dd>{{ formatDate(appHealth.checkedAt) }}</dd></div></dl></section><section class="panel"><header><div><span class="eyebrow">OPERATOR GATEWAY</span><h2>运营网关</h2><p>使用已验证的运营认证与状态契约。</p></div><span class="state-chip" :class="health.status==='ok'?'success':health.status==='error'?'danger':'warning'"><i></i>{{ health.status==='ok'?'可用':health.status==='error'?'不可用':'检查中' }}</span></header><dl class="health-list"><div><dt>健康信号</dt><dd>/ops/v1/health</dd></div><div><dt>认证契约</dt><dd class="success">已启用</dd></div><div><dt>会话探针</dt><dd class="success">不写审计</dd></div></dl></section><section class="panel"><header><div><span class="eyebrow">DATABASE</span><h2>数据源</h2><p>仅显示脱敏后的数据库状态。</p></div></header><dl class="health-list"><div><dt>连接状态</dt><dd :class="health.status==='error'?'danger':''"><i></i>{{ health.status==='ok'?'可用':health.status==='error'?'不可用':'检查中' }}</dd></div><div><dt>数据库类型</dt><dd>{{ health.databaseKind || '—' }}</dd></div><div><dt>最后检查</dt><dd>{{ formatDate(health.checkedAt) }}</dd></div></dl></section><section class="panel"><header><div><span class="eyebrow">SECURITY SURFACE</span><h2>安全边界</h2><p>本页面不提供写操作。</p></div><span class="state-chip success"><i></i>只读</span></header><dl class="health-list"><div><dt>密钥与凭证</dt><dd class="success">不展示</dd></div><div><dt>生产配置</dt><dd class="success">不展示</dd></div><div><dt>状态接口</dt><dd class="success">已认证</dd></div></dl></section></div></section>
        </main></div>
      <template v-if="licenseForm.open"><div class="modal-backdrop" @click="!licenseForm.saving&&(licenseForm.open=false)"></div><form class="modal" role="dialog" aria-modal="true" aria-labelledby="license-title" @submit.prevent="generateLicenses"><header><div><h2 id="license-title">生成兑换码</h2><p>完整兑换码离开后不再显示，请立即复制或下载。</p></div><button type="button" class="icon-btn" aria-label="关闭" :disabled="licenseForm.saving" @click="licenseForm.open=false"><iconify-icon icon="ph:x"></iconify-icon></button></header><div class="modal-body"><template v-if="!licenseForm.generated.length"><div class="form-grid"><label>类型<select v-model="licenseForm.planId"><option value="TRIAL">24 小时体验</option><option value="PRO">PRO</option></select></label><label>时长<select v-model.number="licenseForm.durationHours"><option :value="24">24 小时</option><option :value="720">30 天</option><option :value="2160">90 天</option><option :value="8760">365 天</option></select></label><label>数量<input v-model.number="licenseForm.count" type="number" min="1" max="100"></label><label>兑换截止<input v-model="licenseForm.redeemDeadline" type="datetime-local"></label></div><label>渠道<input v-model.trim="licenseForm.channel" placeholder="例如：合作渠道"></label><label>批次<input v-model.trim="licenseForm.batchId" placeholder="例如：2026-08-UAT-A"></label><label>备注<textarea v-model.trim="licenseForm.note"></textarea></label><p v-if="licenseForm.error" class="form-error" role="alert">{{ licenseForm.error }}</p></template><template v-else><div class="generated-code-list"><code v-for="item in licenseForm.generated" :key="item.id">{{ item.code }}</code></div></template></div><footer><template v-if="licenseForm.generated.length"><button type="button" class="btn" @click="copyGeneratedCodes">复制全部</button><button type="button" class="btn" @click="downloadGeneratedCodes">下载 CSV</button><button type="button" class="btn primary" @click="licenseForm.open=false">完成</button></template><template v-else><button type="button" class="btn" @click="licenseForm.open=false">取消</button><button type="submit" class="btn primary" :disabled="licenseForm.saving">{{ licenseForm.saving?'正在生成…':'生成' }}</button></template></footer></form></template><template v-if="disableConfirm"><div class="modal-backdrop" @click="!busy&&(disableConfirm=null)"></div><section class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="disable-title"><header><div><span class="eyebrow">LICENSE ACTION</span><h2 id="disable-title">确认禁用兑换码</h2><p>禁用后该兑换码将无法继续兑换。</p></div><button type="button" class="icon-btn" aria-label="关闭" :disabled="!!busy" @click="disableConfirm=null"><iconify-icon icon="ph:x"></iconify-icon></button></header><div class="modal-body"><p class="security-note"><iconify-icon icon="ph:warning"></iconify-icon><span>将禁用 <strong>{{ disableConfirm.codeMasked }}</strong>，此操作会写入审计记录。</span></p></div><footer><button type="button" class="btn" :disabled="!!busy" @click="disableConfirm=null">取消</button><button type="button" class="btn primary" :disabled="!!busy" @click="confirmDisableLicense">{{ busy ? '正在禁用…' : '确认禁用' }}</button></footer></section></template>
      <div class="notice-stack" aria-live="polite"><article v-for="item in notices" :key="item.id" :class="item.type"><iconify-icon :icon="item.type==='error'?'ph:warning-circle':'ph:check-circle'"></iconify-icon><span><strong>{{ item.title }}</strong><small>{{ item.message }}</small></span></article></div>
    </div>
  `
}).mount("#ops-app");
