const { createApp, reactive, ref, computed, onMounted, onUnmounted } = Vue;

createApp({
  setup() {
    const session = ref(null);
    const loading = ref(true);
    const login = reactive({ email: "ops-admin@localhost", password: "", sending: false, error: "" });
    const requestedView = new URLSearchParams(location.search).get("view") || "overview";
    const data = reactive({ metrics: {}, tenants: [], plans: [], subscriptions: [], licenses: [], providerCatalog: [], platformConnections: [], tenantConnections: [], aiPolicies: [], aiUsage: [], publishJobs: [], featureFlags: [], supportTickets: [], incidents: [], impersonationSessions: [], auditEvents: [], workspace: null });
    const error = ref("");
    const notices = reactive([]);
    const connectionForm = reactive({ open: false, saving: false, error: "", providerPreset: "deepseek", providerName: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "", costInputPerMillion: 0, costOutputPerMillion: 0, saleMultiplier: 1.5 });
    const ticketForm = reactive({ open: false, title: "", tenantId: "tenant_privlan_demo", priority: "normal", saving: false, error: "" });
    const incidentForm = reactive({ open: false, title: "", severity: "minor", saving: false, error: "" });
    const impersonationForm = reactive({ open: false, tenantId: "", reason: "", minutes: 30, saving: false, error: "" });
    const licenseForm = reactive({ open: false, planId: "PRO", durationHours: 720, count: 10, channel: "", batchId: "", redeemDeadline: "", note: "", saving: false, error: "", generated: [] });
    const busy = ref("");

    const nav = [
      { id: "overview", label: "概览", icon: "ph:gauge" },
      { id: "tenants", label: "租户", icon: "ph:buildings" },
      { id: "plans", label: "套餐", icon: "ph:wallet" },
      { id: "licenses", label: "兑换码", icon: "ph:ticket" },
      { id: "audit", label: "审计", icon: "ph:list-magnifying-glass" }
    ];
    const view = ref(nav.some(item => item.id === requestedView) ? requestedView : "overview");
    const title = computed(() => nav.find(item => item.id === view.value)?.label || "运营后台");
    const activeImpersonation = computed(() => data.impersonationSessions.find(item => item.status === "active" && Date.parse(item.expiresAt) > Date.now()));

    function notice(title, message, type = "success") {
      const item = { id: Date.now() + Math.random(), title, message, type };
      notices.push(item);
      setTimeout(() => { const index = notices.indexOf(item); if (index >= 0) notices.splice(index, 1); }, 4200);
    }

    async function api(url, options = {}) {
      const response = await fetch(url, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) { session.value = null; throw new Error(result.error || "运营会话已过期，请重新登录"); }
      if (!response.ok || !result.ok) throw new Error(result.error || `请求失败（${response.status}）`);
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

    async function loadData() {
      error.value = "";
      try {
        const next = await api("/ops/v1/bootstrap");
        Object.keys(data).forEach(key => { data[key] = next[key] ?? data[key]; });
      } catch (err) { error.value = err.message; }
    }

    function switchView(id) {
      if (!nav.some(item => item.id === id)) id = "overview";
      view.value = id;
      const url = new URL(location.href); url.searchParams.set("view", id); history.replaceState({}, "", url);
    }

    function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
    function formatMoney(value) { return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(Number(value) || 0); }
    function formatDate(value) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
    function statusLabel(value) { return ({ active: "正常", inactive: "未激活", expired: "已到期", trial: "试用", past_due: "欠费", suspended: "暂停", closed: "关闭", unused: "未兑换", partially_used: "部分使用", redeemed: "已兑换", disabled: "已禁用", generated: "已生成开发预览", succeeded: "成功", failed: "失败", draft: "草稿", queued: "等待执行", running: "执行中", rolled_back: "已回滚", open: "待处理", in_progress: "处理中", resolved: "已解决", investigating: "调查中" })[value] || value || "未知"; }

    function applyProviderPreset() {
      const preset = data.providerCatalog.find(item => item.id === connectionForm.providerPreset);
      if (!preset) return;
      connectionForm.providerName = preset.name;
      connectionForm.baseUrl = preset.baseUrl;
      connectionForm.model = preset.model;
    }

    async function createPlatformConnection() {
      connectionForm.error = ""; connectionForm.saving = true;
      try {
        await api("/ops/v1/ai/connections", { method: "POST", body: JSON.stringify(connectionForm) });
        connectionForm.open = false; connectionForm.apiKey = "";
        await loadData(); notice("平台模型已添加", "商户现在可以选择使用平台托管额度。", "success");
      } catch (err) { connectionForm.error = err.message; }
      finally { connectionForm.saving = false; }
    }

    async function testPlatformConnection(connection) {
      busy.value = connection.id;
      try { await api(`/ops/v1/ai/connections/${encodeURIComponent(connection.id)}/test`, { method: "POST", body: "{}" }); await loadData(); notice("连接测试成功", `${connection.providerName} / ${connection.model} 可以正常调用。`); }
      catch (err) { notice("连接测试失败", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function rotatePlatformSecret(connection) {
      const apiKey = window.prompt(`输入 ${connection.providerName} 的新 API Key。保存后不会显示明文：`);
      if (!apiKey) return;
      busy.value = connection.id;
      try { await api(`/ops/v1/ai/connections/${encodeURIComponent(connection.id)}/rotate-secret`, { method: "POST", body: JSON.stringify({ apiKey }) }); await loadData(); notice("平台密钥已轮换", "请测试连接后再供商户使用。", "success"); }
      catch (err) { notice("密钥轮换失败", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function togglePlatformConnection(connection) {
      busy.value = connection.id;
      try { await api(`/ops/v1/ai/connections/${encodeURIComponent(connection.id)}`, { method: "PATCH", body: JSON.stringify({ status: connection.status === "disabled" ? "active" : "disabled" }) }); await loadData(); notice("平台模型状态已更新", connection.status === "disabled" ? "连接已恢复。" : "连接已停用，不再接受新路由。", "success"); }
      catch (err) { notice("状态更新失败", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function deletePlatformConnection(connection) {
      if (!window.confirm(`删除“${connection.providerName} / ${connection.model}”平台连接？`)) return;
      busy.value = connection.id;
      try { await api(`/ops/v1/ai/connections/${encodeURIComponent(connection.id)}`, { method: "DELETE" }); await loadData(); notice("平台模型已删除", "密钥和连接配置已移除。", "success"); }
      catch (err) { notice("平台模型删除失败", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function retryPublish(job) {
      busy.value = job.id;
      try { await api(`/ops/v1/publish-jobs/${encodeURIComponent(job.id)}/retry`, { method: "POST", body: "{}" }); await loadData(); notice("发布重试已排队", `已为 ${job.version} 创建新的重试任务。`, "success"); }
      catch (err) { notice("无法重试发布", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function rollbackPublish(job) {
      if (!window.confirm(`创建回滚到版本 ${job.version} 的任务？`)) return;
      busy.value = job.id;
      try { await api(`/ops/v1/publish-jobs/${encodeURIComponent(job.id)}/rollback`, { method: "POST", body: "{}" }); await loadData(); notice("回滚任务已排队", `目标版本：${job.version}`, "success"); }
      catch (err) { notice("无法创建回滚任务", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function updateTenant(tenant, updates) {
      busy.value = tenant.id;
      try { await api(`/ops/v1/tenants/${encodeURIComponent(tenant.id)}`, { method: "PATCH", body: JSON.stringify(updates) }); await loadData(); notice("租户已更新", "状态与套餐权益已同步。", "success"); }
      catch (err) { notice("租户更新失败", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function updatePlan(plan) {
      busy.value = plan.id;
      try { await api(`/ops/v1/plans/${encodeURIComponent(plan.id)}`, { method: "PATCH", body: JSON.stringify({ monthlyPrice: plan.monthlyPrice, yearlyPrice: plan.yearlyPrice, stores: plan.stores, skuLimit: plan.skuLimit, storageGb: plan.storageGb, aiPoints: plan.aiPoints }) }); await loadData(); notice("套餐已保存", `${plan.name} 的价格与权益已更新。`); }
      catch (err) { notice("套餐保存失败", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function generateLicenses() {
      licenseForm.error = ""; licenseForm.saving = true;
      try { licenseForm.generated = await api("/ops/v1/license-codes", { method: "POST", body: JSON.stringify(licenseForm) }); await loadData(); notice("兑换码已生成", `本批次共 ${licenseForm.generated.length} 个，请立即保存完整兑换码。`); }
      catch (err) { licenseForm.error = err.message; }
      finally { licenseForm.saving = false; }
    }

    async function disableLicense(item) {
      if (!window.confirm(`禁用兑换码 ${item.codeMasked}？`)) return;
      busy.value = item.id;
      try { await api(`/ops/v1/license-codes/${encodeURIComponent(item.id)}/disable`, { method: "PATCH", body: "{}" }); await loadData(); notice("兑换码已禁用", item.codeMasked); }
      catch (err) { notice("无法禁用兑换码", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function extendTenant(tenant, days) {
      busy.value = tenant.workspaceId;
      try { await api(`/ops/v1/subscriptions/${encodeURIComponent(tenant.workspaceId)}/extend`, { method: "POST", body: JSON.stringify({ days }) }); await loadData(); notice("订阅已延长", `${tenant.name} 延长 ${days} 天`); }
      catch (err) { notice("订阅延长失败", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function copyGeneratedCodes() { await navigator.clipboard.writeText(licenseForm.generated.map(item => item.code).join("\n")); notice("已复制", `${licenseForm.generated.length} 个兑换码已复制到剪贴板`); }
    function downloadGeneratedCodes() { const rows = ["code,plan,durationHours", ...licenseForm.generated.map(item => `${item.code},${item.planId},${item.durationHours}`)]; const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" })); link.download = `atelier-license-${Date.now()}.csv`; link.click(); URL.revokeObjectURL(link.href); }

    async function toggleFlag(flag) {
      busy.value = flag.id;
      try { await api(`/ops/v1/feature-flags/${encodeURIComponent(flag.id)}`, { method: "PATCH", body: JSON.stringify({ enabled: !flag.enabled }) }); await loadData(); notice("功能开关已更新", `${flag.name} 已${flag.enabled ? "关闭" : "开启"}。`); }
      catch (err) { notice("功能开关更新失败", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function createTicket() {
      ticketForm.error = ""; ticketForm.saving = true;
      try { await api("/ops/v1/support-tickets", { method: "POST", body: JSON.stringify(ticketForm) }); ticketForm.open = false; ticketForm.title = ""; await loadData(); notice("工单已创建", "已关联到对应租户和审计记录。", "success"); }
      catch (err) { ticketForm.error = err.message; }
      finally { ticketForm.saving = false; }
    }

    async function updateTicket(ticket, status) {
      busy.value = ticket.id;
      try { await api(`/ops/v1/support-tickets/${encodeURIComponent(ticket.id)}`, { method: "PATCH", body: JSON.stringify({ status }) }); await loadData(); }
      catch (err) { notice("工单更新失败", err.message, "error"); }
      finally { busy.value = ""; }
    }

    async function createIncident() {
      incidentForm.error = ""; incidentForm.saving = true;
      try { await api("/ops/v1/incidents", { method: "POST", body: JSON.stringify(incidentForm) }); incidentForm.open = false; incidentForm.title = ""; await loadData(); notice("异常事件已登记", "运营团队可以开始跟踪处理。", "success"); }
      catch (err) { incidentForm.error = err.message; }
      finally { incidentForm.saving = false; }
    }

    function openImpersonation(tenant) {
      Object.assign(impersonationForm, { open: true, tenantId: tenant.id, reason: "", minutes: 30, saving: false, error: "" });
    }

    async function startImpersonation() {
      impersonationForm.error = ""; impersonationForm.saving = true;
      try { await api("/ops/v1/impersonation-sessions", { method: "POST", body: JSON.stringify(impersonationForm) }); impersonationForm.open = false; await loadData(); notice("授权代操作已开始", "顶部会持续显示租户和到期时间，所有操作将写入审计。", "success"); }
      catch (err) { impersonationForm.error = err.message; }
      finally { impersonationForm.saving = false; }
    }

    async function endImpersonation() {
      if (!activeImpersonation.value) return;
      try { await api(`/ops/v1/impersonation-sessions/${encodeURIComponent(activeImpersonation.value.id)}`, { method: "DELETE" }); await loadData(); notice("代操作已结束", "租户数据访问权限已立即收回。", "success"); }
      catch (err) { notice("结束代操作失败", err.message, "error"); }
    }

    function handleKeydown(event) {
      if (event.key !== "Escape") return;
      connectionForm.open = false; ticketForm.open = false; incidentForm.open = false; impersonationForm.open = false; licenseForm.open = false;
    }

    onMounted(() => { checkSession(); window.addEventListener("keydown", handleKeydown); });
    onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
    return { session, loading, login, view, data, error, notices, nav, title, connectionForm, ticketForm, incidentForm, impersonationForm, licenseForm, busy, activeImpersonation, signIn, signOut, loadData, switchView, formatNumber, formatMoney, formatDate, statusLabel, applyProviderPreset, createPlatformConnection, testPlatformConnection, rotatePlatformSecret, togglePlatformConnection, deletePlatformConnection, retryPublish, rollbackPublish, updateTenant, updatePlan, generateLicenses, disableLicense, extendTenant, copyGeneratedCodes, downloadGeneratedCodes, toggleFlag, createTicket, updateTicket, createIncident, openImpersonation, startImpersonation, endImpersonation };
  },
  template: `
    <div v-if="loading" class="ops-loading"><span class="ops-mark">A</span><p>正在验证运营会话…</p></div>
    <main v-else-if="!session" class="login-page">
      <section class="login-panel" aria-labelledby="login-title"><div class="login-brand"><span class="ops-mark">A</span><div><strong translate="no">ATELIER OS</strong><small>CONTROL PLANE</small></div></div><div class="login-copy"><span class="eyebrow">PRIVATE OPERATIONS</span><h1 id="login-title">平台运营后台</h1><p>管理租户、套餐、模型成本、发布任务和平台安全。商户无法访问此处。</p></div><form @submit.prevent="signIn"><label for="ops-email">运营账号</label><input id="ops-email" v-model.trim="login.email" name="email" type="email" autocomplete="username" spellcheck="false" placeholder="name@company.com…"><label for="ops-password">密码</label><input id="ops-password" v-model="login.password" name="password" type="password" autocomplete="current-password" placeholder="输入运营后台密码…"><p v-if="login.error" class="form-error" role="alert">{{ login.error }}</p><button type="submit" :disabled="login.sending || !login.email || !login.password">{{ login.sending ? '正在验证…' : '进入运营后台' }}<iconify-icon icon="ph:arrow-right"></iconify-icon></button></form><footer><iconify-icon icon="ph:shield-check"></iconify-icon><span>独立会话 · 8 小时过期 · 关键操作留痕</span></footer></section><aside class="login-atmosphere" aria-hidden="true"><div class="instrument-lines"><i></i><i></i><i></i><i></i></div><div><span>01 / TENANCY</span><span>02 / MODEL ROUTING</span><span>03 / RELEASE CONTROL</span><span>04 / AUDIT</span></div></aside>
    </main>
    <div v-else class="ops-shell">
      <header class="ops-topbar"><div class="ops-brand"><span class="ops-mark">A</span><div><strong translate="no">ATELIER OS</strong><small>CONTROL PLANE</small></div></div><div class="ops-location"><span>平台运营</span><iconify-icon icon="ph:caret-right" aria-hidden="true"></iconify-icon><strong>{{ title }}</strong></div><div class="ops-actions"><button type="button" class="icon-btn" aria-label="刷新运营数据" @click="loadData"><iconify-icon icon="ph:arrows-clockwise"></iconify-icon></button><span class="operator"><span>{{ session.name.slice(0,1) }}</span><span><strong>{{ session.name }}</strong><small>{{ session.role }}</small></span></span><button type="button" class="btn" @click="signOut">退出</button></div></header>
      <div v-if="activeImpersonation" class="impersonation-banner" role="status"><iconify-icon icon="ph:eye"></iconify-icon><span>正在授权查看租户 <strong>{{ activeImpersonation.tenantId }}</strong> · {{ activeImpersonation.reason }} · 到期 {{ formatDate(activeImpersonation.expiresAt) }}</span><button type="button" @click="endImpersonation">结束代操作</button></div>
      <div class="ops-body"><aside class="ops-sidebar"><nav aria-label="运营导航"><button v-for="item in nav" :key="item.id" type="button" :class="{active:view===item.id}" :aria-current="view===item.id?'page':null" @click="switchView(item.id)"><iconify-icon :icon="item.icon" aria-hidden="true"></iconify-icon><span>{{ item.label }}</span></button></nav><div class="ops-sidebar-foot"><span class="health-dot"></span><span><strong>本地控制面</strong><small>生产环境需接入 KMS / PostgreSQL</small></span></div></aside>
        <main id="ops-main" class="ops-main" tabindex="-1"><div v-if="error" class="page-error" role="alert"><span>{{ error }}</span><button type="button" @click="loadData">重试</button></div>
          <section v-if="view==='overview'" class="ops-page"><header class="page-head"><div><span class="eyebrow">SYSTEM OVERVIEW</span><h1>平台运行概览</h1><p>只展示运营和服务健康数据。敏感客户资料与完整聊天正文默认不可见。</p></div><span class="state-chip success"><i></i>核心服务正常</span></header><div class="metric-grid"><article><span>租户</span><strong>{{ formatNumber(data.metrics.tenants) }}</strong><small>{{ data.metrics.activeTenants }} 个正常 · {{ data.metrics.trials }} 个试用</small></article><article><span>有效订阅</span><strong>{{ data.subscriptions.filter(item=>item.status==='active').length }}</strong><small>来自 PostgreSQL 订阅记录</small></article><article><span>兑换码</span><strong>{{ data.licenses.length }}</strong><small>{{ data.licenses.filter(item=>item.status==='unused').length }} 个未兑换</small></article><article><span>审计记录</span><strong>{{ data.auditEvents.length }}</strong><small>最近 200 条真实操作记录</small></article></div><div class="overview-layout"><section class="panel"><header><div><span class="eyebrow">TENANT PULSE</span><h2>租户状态</h2></div><button type="button" class="text-btn" @click="switchView('tenants')">查看全部</button></header><div class="tenant-pulse"><article v-for="tenant in data.tenants" :key="tenant.id"><span class="tenant-monogram">{{ tenant.name.slice(0,1) }}</span><span><strong>{{ tenant.name }}</strong><small>{{ tenant.id }}</small></span><span class="state-chip" :class="tenant.status==='active'?'success':'warning'">{{ statusLabel(tenant.status) }}</span></article></div></section><section class="panel"><header><div><span class="eyebrow">OPERATIONS</span><h2>服务健康</h2></div></header><dl class="health-list"><div><dt>数据库控制面</dt><dd><i></i>PostgreSQL</dd></div><div><dt>商户账户</dt><dd><i></i>会话与审计已启用</dd></div><div><dt>兑换码</dt><dd><i></i>完整码仅创建时显示</dd></div><div><dt>未开放模块</dt><dd class="warning"><i></i>平台 AI 与自动发布已隐藏</dd></div></dl></section></div></section>
          <section v-else-if="view==='tenants'" class="ops-page"><header class="page-head"><div><span class="eyebrow">TENANT CONTROL</span><h1>租户与工作区</h1><p>运营人员默认只查看状态；需要处理具体问题时，必须创建限时、可审计的代操作会话。</p></div></header><section class="panel table-panel"><table><thead><tr><th>租户</th><th>套餐</th><th>状态</th><th>渠道</th><th>操作</th></tr></thead><tbody><tr v-for="tenant in data.tenants" :key="tenant.id"><td><strong>{{ tenant.name }}</strong><small>{{ tenant.id }}</small></td><td><select :value="tenant.planId" aria-label="租户套餐" @change="updateTenant(tenant,{planId:$event.target.value})"><option v-for="plan in data.plans" :key="plan.id" :value="plan.id">{{ plan.name }}</option></select></td><td><select :value="tenant.status" aria-label="租户状态" @change="updateTenant(tenant,{status:$event.target.value})"><option value="trial">试用</option><option value="active">正常</option><option value="past_due">欠费</option><option value="suspended">暂停</option><option value="closed">关闭</option></select></td><td>{{ data.workspace?.channelMode==='shared'?'共享 AppID':'独立 AppID' }}</td><td><span class="state-chip">{{ tenant.subscriptionStatus ? statusLabel(tenant.subscriptionStatus) : '无订阅' }}</span></td></tr></tbody></table></section></section>
          <section v-else-if="view==='plans'" class="ops-page"><header class="page-head"><div><span class="eyebrow">PLAN ENTITLEMENTS</span><h1>套餐与权益</h1><p>商户端只读取权益，不按套餐名称硬编码功能。价格和额度调整会记录到审计日志。</p></div></header><div class="plan-grid"><form v-for="plan in data.plans" :key="plan.id" class="panel plan-editor" @submit.prevent="updatePlan(plan)"><header><div><span class="eyebrow">{{ plan.id }}</span><h2>{{ plan.name }}</h2></div><span class="state-chip" :class="plan.id===data.workspace?.planId?'success':''">{{ plan.id===data.workspace?.planId?'当前租户':'可用套餐' }}</span></header><div class="form-grid"><label>月费（元）<input v-model.number="plan.monthlyPrice" name="monthly-price" type="number" min="0"></label><label>年费（元）<input v-model.number="plan.yearlyPrice" name="yearly-price" type="number" min="0"></label><label>店铺数<input v-model.number="plan.stores" name="stores" type="number" min="1"></label><label>SKU 上限<input v-model.number="plan.skuLimit" name="sku-limit" type="number" min="0"></label><label>存储（GB）<input v-model.number="plan.storageGb" name="storage-gb" type="number" min="0"></label><label>平台 AI 点数<input v-model.number="plan.aiPoints" name="ai-points" type="number" min="0"></label></div><button class="btn primary" type="submit" :disabled="busy===plan.id">{{ busy===plan.id?'正在保存…':'保存套餐' }}</button></form></div></section>
          <section v-else-if="view==='ai'" class="ops-page"><header class="page-head"><div><span class="eyebrow">MODEL CONTROL</span><h1>AI 服务与成本</h1><p>平台模型用于托管额度；商户自带 API 的密钥不可见。所有模型都通过统一兼容网关和业务权限层。</p></div><button type="button" class="btn primary" @click="connectionForm.open=true"><iconify-icon icon="ph:plus"></iconify-icon>添加平台模型</button></header><div class="metric-grid compact"><article><span>平台连接</span><strong>{{ data.platformConnections.length }}</strong><small>用于托管额度</small></article><article><span>商户连接</span><strong>{{ data.tenantConnections.length }}</strong><small>密钥不可查看</small></article><article><span>加权点数</span><strong>{{ formatNumber(data.metrics.aiPoints) }}</strong><small>输入 1 / 输出 4</small></article><article><span>失败请求</span><strong>{{ data.metrics.aiErrors }}</strong><small>可按 requestId 排查</small></article></div><section class="panel"><header><div><span class="eyebrow">PLATFORM CONNECTIONS</span><h2>平台托管模型</h2></div></header><div v-if="!data.platformConnections.length" class="empty-state"><iconify-icon icon="ph:cloud-slash"></iconify-icon><strong>还没有平台模型</strong><p>添加付费且稳定的模型连接后，商户才能选择平台托管额度。</p></div><div v-else class="connection-list"><article v-for="connection in data.platformConnections" :key="connection.id"><span class="connection-icon"><iconify-icon icon="ph:circuitry"></iconify-icon></span><span><strong>{{ connection.providerName }} · {{ connection.model }}</strong><small>{{ connection.baseUrl }} · 密钥 {{ connection.secretHint }}</small></span><span class="state-chip" :class="connection.status==='disabled'?'danger':connection.lastTestOk===true?'success':connection.lastTestOk===false?'danger':'warning'">{{ connection.status==='disabled'?'已停用':connection.lastTestOk===true?'可用':connection.lastTestOk===false?'失败':'待测试' }}</span><div class="connection-buttons"><button type="button" class="btn small" :disabled="busy===connection.id" @click="testPlatformConnection(connection)">测试</button><button type="button" class="icon-btn" aria-label="轮换平台 API Key" title="轮换 API Key" @click="rotatePlatformSecret(connection)"><iconify-icon icon="ph:arrows-clockwise"></iconify-icon></button><button type="button" class="icon-btn" :aria-label="connection.status==='disabled'?'恢复平台模型':'停用平台模型'" :title="connection.status==='disabled'?'恢复':'停用'" @click="togglePlatformConnection(connection)"><iconify-icon :icon="connection.status==='disabled'?'ph:play':'ph:pause'"></iconify-icon></button><button type="button" class="icon-btn danger" aria-label="删除平台模型" title="删除平台模型" @click="deletePlatformConnection(connection)"><iconify-icon icon="ph:trash"></iconify-icon></button></div></article></div></section><section class="panel table-panel"><header><div><span class="eyebrow">USAGE EVENTS</span><h2>最近模型调用</h2></div></header><table><thead><tr><th>请求</th><th>租户</th><th>提供方 / 模型</th><th>计费</th><th>点数</th><th>时间</th></tr></thead><tbody><tr v-if="!data.aiUsage.length"><td colspan="6" class="empty-cell">暂无调用记录</td></tr><tr v-for="item in data.aiUsage" :key="item.id"><td><code>{{ item.id }}</code></td><td>{{ item.tenantId }}</td><td>{{ item.provider }}<small>{{ item.model || '—' }}</small></td><td>{{ item.billingMode==='platform'?'平台托管':item.billingMode==='byok'?'商户自带':'规则' }}</td><td>{{ formatNumber(item.weightedPoints) }}</td><td>{{ formatDate(item.createdAt) }}</td></tr></tbody></table></section></section>
          <section v-else-if="view==='publishing'" class="ops-page"><header class="page-head"><div><span class="eyebrow">RELEASE CONTROL</span><h1>发布任务</h1><p>统一查看共享与独立 AppID 的版本、环境、日志、失败重试和回滚状态。</p></div></header><section class="panel table-panel"><table><thead><tr><th>版本</th><th>环境</th><th>渠道</th><th>状态</th><th>请求编号</th><th>时间</th><th>操作</th></tr></thead><tbody><tr v-if="!data.publishJobs.length"><td colspan="7" class="empty-cell">尚无发布任务</td></tr><tr v-for="job in data.publishJobs" :key="job.id"><td><strong>{{ job.version }}</strong></td><td>{{ job.environment }}</td><td>{{ job.channel }}</td><td><span class="state-chip" :class="job.status==='succeeded'?'success':job.status==='failed'?'danger':'warning'">{{ statusLabel(job.status) }}</span></td><td><code>{{ job.requestId || job.id }}</code></td><td>{{ formatDate(job.createdAt) }}</td><td><button v-if="job.status==='failed'" type="button" class="btn small" :disabled="busy===job.id" @click="retryPublish(job)">重试</button><button v-else-if="job.status==='succeeded'" type="button" class="btn small" :disabled="busy===job.id" @click="rollbackPublish(job)">回滚到此版本</button><span v-else>—</span></td></tr></tbody></table></section></section>
          <section v-else-if="view==='flags'" class="ops-page"><header class="page-head"><div><span class="eyebrow">FEATURE GOVERNANCE</span><h1>功能开关</h1><p>按平台或租户控制能力，避免为了单个客户修改和重新发布代码。</p></div></header><section class="panel flag-list"><article v-for="flag in data.featureFlags" :key="flag.id"><span class="flag-icon"><iconify-icon icon="ph:toggle-left"></iconify-icon></span><span><strong>{{ flag.name }}</strong><small>{{ flag.scope==='global'?'全平台':flag.scope==='tenant'?'指定租户':'指定套餐' }} · {{ flag.targetId || '全部' }}</small></span><button type="button" class="switch" :class="{on:flag.enabled}" :aria-label="(flag.enabled?'关闭':'开启')+flag.name" :disabled="busy===flag.id" @click="toggleFlag(flag)"><i></i></button></article></section></section>
          <section v-else-if="view==='support'" class="ops-page"><header class="page-head"><div><span class="eyebrow">SUPPORT & INCIDENTS</span><h1>工单与异常事件</h1><p>工单关联租户，异常事件用于平台级故障。两者都关联请求编号和审计记录。</p></div><div class="head-actions"><button type="button" class="btn" @click="incidentForm.open=true"><iconify-icon icon="ph:warning"></iconify-icon>登记事件</button><button type="button" class="btn primary" @click="ticketForm.open=true"><iconify-icon icon="ph:plus"></iconify-icon>新建工单</button></div></header><div class="support-grid"><section class="panel"><header><div><span class="eyebrow">TICKETS</span><h2>客户工单</h2></div><span class="state-chip">{{ data.supportTickets.length }}</span></header><div v-if="!data.supportTickets.length" class="empty-state compact"><p>暂时没有工单。</p></div><div v-else class="support-list"><article v-for="ticket in data.supportTickets" :key="ticket.id"><span><strong>{{ ticket.title }}</strong><small>{{ ticket.tenantId }} · {{ ticket.priority }} · {{ formatDate(ticket.createdAt) }}</small></span><select :value="ticket.status" aria-label="工单状态" @change="updateTicket(ticket,$event.target.value)"><option value="open">待处理</option><option value="in_progress">处理中</option><option value="resolved">已解决</option><option value="closed">已关闭</option></select></article></div></section><section class="panel"><header><div><span class="eyebrow">INCIDENTS</span><h2>平台异常</h2></div><span class="state-chip" :class="data.metrics.activeIncidents?'danger':'success'">{{ data.metrics.activeIncidents }}</span></header><div v-if="!data.incidents.length" class="empty-state compact"><p>当前没有登记异常。</p></div><div v-else class="support-list"><article v-for="incident in data.incidents" :key="incident.id"><span><strong>{{ incident.title }}</strong><small>{{ incident.severity }} · {{ formatDate(incident.createdAt) }}</small></span><span class="state-chip warning">{{ statusLabel(incident.status) }}</span></article></div></section></div></section>
          <section v-else-if="view==='audit'" class="ops-page"><header class="page-head"><div><span class="eyebrow">IMMUTABLE TRAIL</span><h1>审计记录</h1><p>记录运营登录、租户变更、模型配置、功能开关和授权代操作；不记录 API Key 或完整聊天正文。</p></div></header><section class="panel table-panel"><table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>资源</th><th>租户</th><th>编号</th></tr></thead><tbody><tr v-if="!data.auditEvents.length"><td colspan="6" class="empty-cell">暂无审计记录</td></tr><tr v-for="item in data.auditEvents" :key="item.id"><td>{{ formatDate(item.createdAt) }}</td><td>{{ item.actorId }}</td><td><strong>{{ item.action }}</strong></td><td>{{ item.resourceType }}<small>{{ item.resourceId || '—' }}</small></td><td>{{ item.tenantId || '平台' }}</td><td><code>{{ item.id }}</code></td></tr></tbody></table></section></section>
          <section v-if="view==='licenses'" class="ops-page">
            <header class="page-head"><div><h1>兑换码</h1><p>生成体验或 PRO 兑换码，查看使用状态并管理商户订阅。完整兑换码只在生成后显示一次。</p></div><button type="button" class="btn primary" @click="licenseForm.open=true;licenseForm.generated=[]"><iconify-icon icon="ph:plus"></iconify-icon>生成兑换码</button></header>
            <div class="metric-grid compact"><article><span>总计</span><strong>{{ data.licenses.length }}</strong></article><article><span>未兑换</span><strong>{{ data.licenses.filter(item=>item.status==='unused').length }}</strong></article><article><span>已兑换</span><strong>{{ data.licenses.filter(item=>item.status==='redeemed').length }}</strong></article><article><span>已禁用</span><strong>{{ data.licenses.filter(item=>item.status==='disabled').length }}</strong></article></div>
            <section class="panel table-panel"><table><thead><tr><th>兑换码</th><th>类型</th><th>时长</th><th>状态</th><th>渠道 / 批次</th><th>生成时间</th><th>兑换信息</th><th>操作</th></tr></thead><tbody><tr v-if="!data.licenses.length"><td colspan="8" class="empty-cell">还没有兑换码</td></tr><tr v-for="item in data.licenses" :key="item.id"><td><code>{{ item.codeMasked }}</code></td><td>{{ item.planId }}</td><td>{{ item.durationHours }} 小时</td><td><span class="state-chip" :class="item.status==='redeemed'?'success':item.status==='disabled'?'danger':'warning'">{{ statusLabel(item.status) }}</span></td><td>{{ item.channel || '—' }}<small>{{ item.batchId || '无批次' }}</small></td><td>{{ formatDate(item.createdAt) }}</td><td>{{ item.workspaceId || '尚未兑换' }}<small>{{ formatDate(item.redeemedAt) }}</small></td><td><button v-if="item.status==='unused'" type="button" class="btn small" :disabled="busy===item.id" @click="disableLicense(item)">禁用</button></td></tr></tbody></table></section>
            <section class="panel table-panel subscription-table"><header><div><h2>商户订阅</h2><p>人工续期会写入审计记录。</p></div></header><table><thead><tr><th>商户</th><th>套餐</th><th>状态</th><th>到期时间</th><th>续期</th></tr></thead><tbody><tr v-for="tenant in data.tenants" :key="tenant.id"><td><strong>{{ tenant.name }}</strong><small>{{ tenant.workspaceId }}</small></td><td>{{ tenant.planId }}</td><td>{{ tenant.subscriptionStatus }}</td><td>{{ formatDate(tenant.expiresAt) }}</td><td><div class="connection-buttons"><button class="btn small" @click="extendTenant(tenant,1)">+1 天</button><button class="btn small" @click="extendTenant(tenant,7)">+7 天</button><button class="btn small" @click="extendTenant(tenant,30)">+30 天</button></div></td></tr></tbody></table></section>
          </section>
        </main></div>
      <template v-if="licenseForm.open"><div class="modal-backdrop" @click="!licenseForm.saving&&(licenseForm.open=false)"></div><form class="modal" role="dialog" aria-modal="true" aria-labelledby="license-title" @submit.prevent="generateLicenses"><header><div><h2 id="license-title">生成兑换码</h2><p>完整兑换码离开后不再显示，请立即复制或下载。</p></div><button type="button" class="icon-btn" aria-label="关闭" :disabled="licenseForm.saving" @click="licenseForm.open=false"><iconify-icon icon="ph:x"></iconify-icon></button></header><div class="modal-body"><template v-if="!licenseForm.generated.length"><div class="form-grid"><label>类型<select v-model="licenseForm.planId"><option value="TRIAL">24 小时体验</option><option value="PRO">PRO</option></select></label><label>时长<select v-model.number="licenseForm.durationHours"><option :value="24">24 小时</option><option :value="720">30 天</option><option :value="2160">90 天</option><option :value="8760">365 天</option></select></label><label>数量<input v-model.number="licenseForm.count" type="number" min="1" max="100"></label><label>兑换截止<input v-model="licenseForm.redeemDeadline" type="datetime-local"></label></div><label>渠道<input v-model.trim="licenseForm.channel" placeholder="例如：闲鱼"></label><label>批次<input v-model.trim="licenseForm.batchId" placeholder="例如：2026-08-MVP-A"></label><label>备注<textarea v-model.trim="licenseForm.note"></textarea></label><p v-if="licenseForm.error" class="form-error" role="alert">{{ licenseForm.error }}</p></template><template v-else><div class="generated-code-list"><code v-for="item in licenseForm.generated" :key="item.id">{{ item.code }}</code></div></template></div><footer><template v-if="licenseForm.generated.length"><button type="button" class="btn" @click="copyGeneratedCodes">复制全部</button><button type="button" class="btn" @click="downloadGeneratedCodes">下载 CSV</button><button type="button" class="btn primary" @click="licenseForm.open=false">完成</button></template><template v-else><button type="button" class="btn" @click="licenseForm.open=false">取消</button><button type="submit" class="btn primary" :disabled="licenseForm.saving">{{ licenseForm.saving?'正在生成…':'生成' }}</button></template></footer></form></template>
      <template v-if="connectionForm.open"><div class="modal-backdrop" @click="connectionForm.open=false"></div><form class="modal" role="dialog" aria-modal="true" aria-labelledby="connection-title" @submit.prevent="createPlatformConnection"><header><div><span class="eyebrow">PLATFORM MODEL</span><h2 id="connection-title">添加平台托管模型</h2><p>此密钥用于平台额度，成本由平台承担。请配置计费成本和销售倍率。</p></div><button type="button" class="icon-btn" aria-label="关闭" @click="connectionForm.open=false"><iconify-icon icon="ph:x"></iconify-icon></button></header><div class="modal-body"><div class="security-note"><iconify-icon icon="ph:lock-key"></iconify-icon><p>密钥加密保存且不会回显。生产环境请将本地主密钥替换为腾讯云 KMS。</p></div><label>供应商预设<select v-model="connectionForm.providerPreset" name="provider-preset" @change="applyProviderPreset"><option v-for="provider in data.providerCatalog" :key="provider.id" :value="provider.id">{{ provider.name }}</option></select></label><label>显示名称<input v-model.trim="connectionForm.providerName" name="provider-name" autocomplete="off" placeholder="平台默认模型…"></label><label>API 地址<input v-model.trim="connectionForm.baseUrl" name="base-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1…"></label><label>模型名称<input v-model.trim="connectionForm.model" name="model" autocomplete="off" spellcheck="false" placeholder="model-name…"></label><label>API Key<input v-model="connectionForm.apiKey" name="api-key" type="password" autocomplete="new-password" spellcheck="false" placeholder="sk-…"></label><div class="form-grid"><label>输入成本 / 百万 Token<input v-model.number="connectionForm.costInputPerMillion" name="input-cost" type="number" min="0" step="0.01"></label><label>输出成本 / 百万 Token<input v-model.number="connectionForm.costOutputPerMillion" name="output-cost" type="number" min="0" step="0.01"></label><label>销售倍率<input v-model.number="connectionForm.saleMultiplier" name="sale-multiplier" type="number" min="1" step="0.1"></label></div><p v-if="connectionForm.error" class="form-error" role="alert">{{ connectionForm.error }}</p></div><footer><button type="button" class="btn" @click="connectionForm.open=false">取消</button><button type="submit" class="btn primary" :disabled="connectionForm.saving">{{ connectionForm.saving?'正在加密保存…':'保存平台模型' }}</button></footer></form></template>
      <template v-if="ticketForm.open"><div class="modal-backdrop" @click="ticketForm.open=false"></div><form class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-title" @submit.prevent="createTicket"><header><div><span class="eyebrow">SUPPORT TICKET</span><h2 id="ticket-title">新建客户工单</h2></div><button type="button" class="icon-btn" aria-label="关闭" @click="ticketForm.open=false"><iconify-icon icon="ph:x"></iconify-icon></button></header><div class="modal-body"><label>租户<select v-model="ticketForm.tenantId" name="tenant"><option v-for="tenant in data.tenants" :key="tenant.id" :value="tenant.id">{{ tenant.name }}</option></select></label><label>标题<input v-model.trim="ticketForm.title" name="title" autocomplete="off" placeholder="具体说明客户遇到的问题…"></label><label>优先级<select v-model="ticketForm.priority" name="priority"><option value="low">低</option><option value="normal">普通</option><option value="high">高</option><option value="urgent">紧急</option></select></label><p v-if="ticketForm.error" class="form-error" role="alert">{{ ticketForm.error }}</p></div><footer><button type="button" class="btn" @click="ticketForm.open=false">取消</button><button type="submit" class="btn primary" :disabled="ticketForm.saving">创建工单</button></footer></form></template>
      <template v-if="incidentForm.open"><div class="modal-backdrop" @click="incidentForm.open=false"></div><form class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="incident-title" @submit.prevent="createIncident"><header><div><span class="eyebrow">PLATFORM INCIDENT</span><h2 id="incident-title">登记异常事件</h2></div><button type="button" class="icon-btn" aria-label="关闭" @click="incidentForm.open=false"><iconify-icon icon="ph:x"></iconify-icon></button></header><div class="modal-body"><label>事件标题<input v-model.trim="incidentForm.title" name="title" autocomplete="off" placeholder="例如：发布队列延迟…"></label><label>严重程度<select v-model="incidentForm.severity" name="severity"><option value="minor">轻微</option><option value="major">重大</option><option value="critical">严重</option></select></label><p v-if="incidentForm.error" class="form-error" role="alert">{{ incidentForm.error }}</p></div><footer><button type="button" class="btn" @click="incidentForm.open=false">取消</button><button type="submit" class="btn primary" :disabled="incidentForm.saving">登记事件</button></footer></form></template>
      <template v-if="impersonationForm.open"><div class="modal-backdrop" @click="impersonationForm.open=false"></div><form class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="impersonation-title" @submit.prevent="startImpersonation"><header><div><span class="eyebrow">AUDITED ACCESS</span><h2 id="impersonation-title">授权代操作</h2><p>权限到期后自动失效，查看和修改行为全部写入审计。</p></div><button type="button" class="icon-btn" aria-label="关闭" @click="impersonationForm.open=false"><iconify-icon icon="ph:x"></iconify-icon></button></header><div class="modal-body"><label>租户<input :value="impersonationForm.tenantId" name="tenant" disabled></label><label>处理原因<textarea v-model.trim="impersonationForm.reason" name="reason" rows="4" placeholder="说明工单、故障或客户授权原因…"></textarea></label><label>有效时间<select v-model.number="impersonationForm.minutes" name="minutes"><option :value="15">15 分钟</option><option :value="30">30 分钟</option><option :value="60">60 分钟</option></select></label><p v-if="impersonationForm.error" class="form-error" role="alert">{{ impersonationForm.error }}</p></div><footer><button type="button" class="btn" @click="impersonationForm.open=false">取消</button><button type="submit" class="btn primary" :disabled="impersonationForm.saving">开始授权代操作</button></footer></form></template>
      <div class="notice-stack" aria-live="polite"><article v-for="item in notices" :key="item.id" :class="item.type"><iconify-icon :icon="item.type==='error'?'ph:warning-circle':'ph:check-circle'"></iconify-icon><span><strong>{{ item.title }}</strong><small>{{ item.message }}</small></span></article></div>
    </div>
  `
}).mount("#ops-app");
