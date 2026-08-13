const { createApp, ref, reactive, computed, watch, nextTick } = Vue;

createApp({
  setup() {
    const cfg = ref({
      brand: { name: "PRIVLAN", slogan: "" }, theme: { colors: { bgPrimary: "#0a0a0a", bgSecondary: "#161616", bgTertiary: "#1e1e1e", textPrimary: "#f0f0f0", textSecondary: "#8a8a8a", accent: "#c9a97e", border: "#2a2a2a" } },
      heroes: [], categories: [], products: [], memberBenefits: [], homeChannels: ["推荐", "LAKE MAGGIORE"], customFonts: [], customPages: [], pageLayouts: { home: [] }, designSystem: { blockDefaults: {} }
    });
    const loading = ref(true);
    const loadError = ref("");
    const currentView = ref("editor");
    const currentPage = ref("home");
    const leftPanelOpen = ref(true);
    const rightPanelOpen = ref(true);
    const selectedId = ref(null);
    const inspectorTab = ref("content");
    const device = ref("mobile");
    const zoom = ref(100);
    const saveMode = ref("saved");
    const savedSnapshot = ref("");
    const history = ref([]);
    const historyIndex = ref(-1);
    const restoring = ref(false);
    const media = ref([]);
    const mediaFolders = ref([]);
    const mediaFolderId = ref("");
    const mediaMoveTarget = ref("");
    const mediaLoading = ref(false);
    const mediaError = ref("");
    const mediaQuery = ref("");
    const selectedMedia = ref(null);
    const mediaSelectionMode = ref(false);
    const selectedMediaNames = ref([]);
    const mediaDeleting = ref(false);
    const selectedSlideIndex = ref(0);
    const hotspotEditMode = ref(false);
    const selectedHotspotId = ref(null);
    const mediaPickerOpen = ref(false);
    const mediaPickerMode = ref("add");
    const productMediaSlot = ref(null);
    const productMediaTarget = ref("gallery");
    const tabBarMediaTarget = reactive({ index: 0, field: "icon" });
    const tabBarCrop = reactive({
      open: false, index: 0, field: "icon", source: "", zoom: 1,
      offsetX: 0, offsetY: 0, imageWidth: 0, imageHeight: 0,
      loading: false, applying: false, error: "", isGif: false
    });
    const tabBarCropCanvas = ref(null);
    const tabBarCropPreviewCanvas = ref(null);
    const fontUploading = ref(false);
    const systemFonts = ref([]);
    const systemFontsLoading = ref(false);
    const productQuery = ref("");
    const productCategory = ref("all");
    const editingProduct = ref(null);
    const newPage = reactive({ open: false, name: "", slug: "", error: "" });
    const homeNavOpen = ref(false);
    const blockQuickAddOpen = ref(false);
    const previewDialog = reactive({ open: false, state: "idle", qrUrl: "", error: "" });
    const serviceBotDrag = reactive({ active: false, pointerId: null, startX: 0, startY: 0, startRight: 24, startBottom: 150, moved: false });
    const serviceBotSuppressClick = ref(false);
    const servicePreview = reactive({
      open: false, screen: "chat", draft: "", messages: [], sending: false,
      appointment: { service: "量体与定制咨询", store: "PRIVLAN 上海会所", date: "8月16日", slot: "14:00", advisor: "林顾问", notes: "" },
      appointmentDone: false
    });
    const cart = ref([]);
    const toasts = reactive([]);
    let historyTimer;
    let dragSlideIndex = -1;
    let tabBarCropImage = null;
    let tabBarCropDrag = null;

    try {
      leftPanelOpen.value = localStorage.getItem("privlan:left-panel") !== "closed";
      rightPanelOpen.value = localStorage.getItem("privlan:right-panel") !== "closed";
    } catch (error) { /* storage is optional */ }

    const fontPresets = [
      { id: "system", name: "现代系统体", stack: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif' },
      { id: "luxury-serif", name: "奢雅宋体", stack: '"Noto Serif SC", "Songti SC", serif' },
      { id: "clean-sans", name: "清朗黑体", stack: '"Noto Sans SC", "PingFang SC", sans-serif' },
      { id: "editorial", name: "编辑衬线体", stack: 'Cormorant Garamond, "Noto Serif SC", serif' },
      { id: "geometric", name: "几何现代体", stack: '"DM Sans", "PingFang SC", sans-serif' },
      { id: "soft", name: "温润圆体", stack: 'Nunito Sans, "PingFang SC", sans-serif' }
    ];

    const builtInPages = [
      { id: "home", name: "首页", path: "/pages/home/home", tab: true, icon: "ph:house" },
      { id: "category", name: "分类", path: "/pages/category/category", tab: true, icon: "ph:squares-four" },
      { id: "campaign", name: "系列活动", path: "/pages/campaign/campaign", tab: true, icon: "ph:sparkle" },
      { id: "cart", name: "购物车", path: "/pages/cart/cart", tab: true, icon: "ph:shopping-bag" },
      { id: "mine", name: "我的", path: "/pages/mine/mine", tab: true, icon: "ph:user-circle" },
      { id: "detail", name: "商品详情", path: "/pages/detail/detail", tab: false, icon: "ph:article" },
      { id: "appointment", name: "预约到店", path: "/pages/appointment/index", tab: false, icon: "ph:calendar-check" }
    ];

    const pageDefinitions = computed(() => [
      ...builtInPages,
      ...(cfg.value?.customPages || [])
    ]);

    const navItems = [
      { id: "editor", label: "搭建", icon: "ph:squares-four" },
      { id: "products", label: "商品", icon: "ph:handbag" },
      { id: "categories", label: "分类", icon: "ph:tree-structure" },
      { id: "media", label: "媒体", icon: "ph:image-square" },
      { id: "theme", label: "主题", icon: "ph:palette" },
      { id: "settings", label: "设置", icon: "ph:gear-six" }
    ];

    const blockLibrary = [
      { type: "hero", name: "首屏轮播", help: "大图与主行动", icon: "ph:images" },
      { type: "media", name: "媒体背景", help: "纯色、图片或视频", icon: "ph:film-strip" },
      { type: "categories", name: "分类导航", help: "横向快捷入口", icon: "ph:list-dashes" },
      { type: "product-grid", name: "商品列表", help: "可筛选商品网格", icon: "ph:grid-four" },
      { type: "member-banner", name: "会员权益", help: "品牌会员模块", icon: "ph:crown" },
      { type: "product-detail", name: "商品详情", help: "图片、价格与购买", icon: "ph:article" },
      { type: "appointment-hero", name: "预约页头图", help: "预约页标题与说明", icon: "ph:calendar-check" },
      { type: "appointment-form", name: "预约表单", help: "服务、门店与时间字段", icon: "ph:clipboard-text" },
      { type: "appointment-notes", name: "预约备注", help: "到店需求与备注", icon: "ph:note-pencil" },
      { type: "appointment-submit", name: "预约提交", help: "提交按钮与成功反馈", icon: "ph:check-circle" },
      { type: "text", name: "图文标题", help: "标题与说明文字", icon: "ph:text-t" },
      { type: "spacer", name: "留白", help: "控制页面节奏", icon: "ph:arrows-out-line-vertical" }
    ];
    const mediaExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif", "mp4", "webm", "mov"]);
    const tabBarGifMaxBytes = 1.2 * 1024 * 1024;

    const viewTitle = computed(() => {
      if (currentView.value === "editor") {
        const page = pageDefinitions.value.find(item => item.id === currentPage.value);
        return `${page?.name || "页面"}编辑`;
      }
      return ({
        products: "商品管理", categories: "分类管理", media: "媒体库",
        theme: "主题设置", settings: "全局设置"
      })[currentView.value] || "编辑器";
    });

    const currentPageMeta = computed(() => pageDefinitions.value.find(page => page.id === currentPage.value) || pageDefinitions.value[0]);
    const sections = computed(() => cfg.value?.pageLayouts?.[currentPage.value] || []);
    const selectedSection = computed(() => sections.value.find(s => s.id === selectedId.value) || null);
    const selectedHeroSlide = computed(() => {
      const slides = selectedSection.value?.type === "hero" ? selectedSection.value.props.slides || [] : [];
      if (selectedSlideIndex.value >= slides.length) selectedSlideIndex.value = Math.max(0, slides.length - 1);
      return slides[selectedSlideIndex.value] || null;
    });
    const hotspotOwner = computed(() => {
      if (selectedSection.value?.type === "hero") return selectedHeroSlide.value;
      if (selectedSection.value?.type === "media") return selectedSection.value.props;
      return selectedSection.value?.props || null;
    });
    const currentHotspots = computed(() => hotspotOwner.value?.hotspots || []);
    const selectedHotspot = computed(() => currentHotspots.value.find(item => item.id === selectedHotspotId.value) || null);
    const fontOptions = computed(() => [
      ...fontPresets,
      ...(cfg.value.customFonts || []).map(font => ({ id: font.id, name: font.name, stack: `"${font.id}", "PingFang SC", sans-serif`, custom: true })),
      ...systemFonts.value.map(font => ({ id: `system:${font.name}`, name: `电脑 · ${font.name}`, stack: `"${font.name}", "PingFang SC", sans-serif`, system: true, file: font.file }))
    ]);
    const hasStyleOverrides = computed(() => Boolean(selectedSection.value?.overrideKeys?.length));
    const isDirty = computed(() => cfg.value && JSON.stringify(cfg.value) !== savedSnapshot.value);
    const canUndo = computed(() => historyIndex.value > 0);
    const canRedo = computed(() => historyIndex.value >= 0 && historyIndex.value < history.value.length - 1);
    const cartLines = computed(() => cart.value.map(line => {
      const product = cfg.value?.products.find(item => Number(item.id) === Number(line.id));
      return { ...line, product: product || line, total: (Number(line.price) || 0) * (Number(line.quantity) || 0) };
    }));
    const cartSummary = computed(() => cartLines.value.reduce((total, line) => {
      total.quantity += Number(line.quantity) || 0;
      total.price += Number(line.total) || 0;
      return total;
    }, { quantity: 0, price: 0 }));

    const filteredProducts = computed(() => {
      if (!cfg.value) return [];
      const q = productQuery.value.trim().toLowerCase();
      return cfg.value.products.filter(p => {
        const inCat = productCategory.value === "all" || p.cat === productCategory.value;
        const inQuery = !q || String(p.name).toLowerCase().includes(q) || String(p.id).includes(q);
        return inCat && inQuery;
      });
    });

    const filteredMedia = computed(() => {
      const q = mediaQuery.value.trim().toLowerCase();
      return media.value.filter(item => {
        const inFolder = !mediaFolderId.value || item.folderId === mediaFolderId.value;
        return inFolder && (!q || item.name.toLowerCase().includes(q));
      });
    });
    const selectedMediaCount = computed(() => selectedMediaNames.value.length);
    const allFilteredMediaSelected = computed(() => filteredMedia.value.length > 0
      && filteredMedia.value.every(item => selectedMediaNames.value.includes(item.name)));
    const mediaPickerItems = computed(() => ["tabbar", "servicebot"].includes(mediaPickerMode.value)
      ? filteredMedia.value.filter(item => item.kind !== "video")
      : filteredMedia.value
    );
    function mediaKindLabel(item) {
      if (item?.kind === "video") return "视频";
      if (/\.gif(?:$|\?)/i.test(String(item?.name || item?.path || ""))) return "GIF 动图";
      return "图片";
    }
    const centerTabStyle = computed(() => {
      const tabBar = cfg.value?.tabBar || {};
      const centerSize = Number(tabBar.centerSize);
      const centerLift = Number(tabBar.centerLift);
      return {
        "--tab-center-size": `${Math.round((Number.isFinite(centerSize) ? centerSize : 96) * .42)}px`,
        "--tab-center-lift": `${Math.round((Number.isFinite(centerLift) ? centerLift : 56) * .42)}px`
      };
    });
    const serviceBotStyle = computed(() => {
      const bot = cfg.value?.serviceBot || {};
      const size = Number(bot.size) || 88;
      if (device.value === "desktop") {
        return { width: "52px", height: "52px", right: "28px", top: "560px" };
      }
      const scale = 390 / 750;
      const visualSize = Math.round(size * scale);
      const visualBottom = Math.round((Number(bot.bottom) || 150) * scale);
      return {
        width: `${visualSize}px`, height: `${visualSize}px`,
        right: `${Math.round((Number(bot.right) || 24) * scale)}px`,
        top: `${Math.max(12, 720 - visualBottom - visualSize)}px`
      };
    });

    function makeId(type) {
      return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, Number(value) || 0));
    }

    function normalizeCrop(crop = {}) {
      return {
        zoom: clamp(crop.zoom ?? 1, 1, 3),
        offsetX: clamp(crop.offsetX ?? 0, -1, 1),
        offsetY: clamp(crop.offsetY ?? 0, -1, 1)
      };
    }

    function normalizeHotspot(hotspot = {}, index = 0) {
      const width = clamp(hotspot.width ?? 30, 4, 100);
      const height = clamp(hotspot.height ?? 18, 4, 100);
      return {
        id: hotspot.id || makeId("hotspot"), label: hotspot.label || `热区 ${index + 1}`,
        x: clamp(hotspot.x ?? 35, 0, 100 - width), y: clamp(hotspot.y ?? 41, 0, 100 - height),
        width, height, linkType: hotspot.linkType || "page",
        linkValue: hotspot.linkValue || "/pages/category/category"
      };
    }

    function normalizeProduct(product = {}) {
      const gallery = [...(Array.isArray(product.gallery) ? product.gallery : []), product.img]
        .filter(path => typeof path === "string" && path.trim())
        .filter((path, index, list) => list.indexOf(path) === index)
        .slice(0, 5);
      const colors = (Array.isArray(product.colors) ? product.colors : []).map((color, index) => {
        if (typeof color === "string") return { name: color, value: "#1f1d1a" };
        return { name: color?.name || `颜色 ${index + 1}`, value: color?.value || color?.hex || "#1f1d1a" };
      }).filter(color => color.name);
      const sizes = (Array.isArray(product.sizes) ? product.sizes : []).map(size => String(size || "").trim()).filter(Boolean);
      const detailImages = (Array.isArray(product.detailImages) ? product.detailImages : []).filter(path => typeof path === "string" && path.trim()).slice(0, 12);
      const cover = gallery[0] || (product.img === undefined ? "/images/p1.jpg" : String(product.img || ""));
      return { ...product, gallery, img: cover, colors, sizes, description: String(product.description || ""), detail: String(product.detail || ""), detailImages };
    }

    function normalizeTabBar(data) {
      const defaults = [
        { text: "首页", icon: "/images/tab-home.png", iconOn: "/images/tab-home-on.png" },
        { text: "分类", icon: "/images/tab-grid.png", iconOn: "/images/tab-grid-on.png" },
        { text: "夏季系列", center: true, centerIcon: "/images/tab-center.png" },
        { text: "购物车", icon: "/images/tab-bag.png", iconOn: "/images/tab-bag-on.png" },
        { text: "我的", icon: "/images/tab-user.png", iconOn: "/images/tab-user-on.png" }
      ];
      const source = data.tabBar || {};
      const items = Array.isArray(source.items) ? source.items : [];
      const normalizedItems = defaults.map((item, index) => {
        const merged = { ...item, ...(items[index] || {}), center: index === 2 };
        const fields = merged.center ? ["centerIcon"] : ["icon", "iconOn"];
        fields.forEach(field => {
          const sourceField = `${field}Source`;
          const cropField = `${field}Crop`;
          merged[sourceField] = merged[sourceField] || merged[field];
          merged[cropField] = normalizeCrop(merged[cropField]);
        });
        return merged;
      });
      data.tabBar = {
        ...source,
        centerSize: clamp(source.centerSize ?? 96, 72, 140),
        centerLift: clamp(source.centerLift ?? 56, 0, 90),
        items: normalizedItems
      };
    }

    function sectionStyleDefaults(type, designSystem = cfg.value?.designSystem) {
      const global = designSystem?.blockDefaults || {};
      const common = {
        backgroundColor: "transparent", textColor: "", fontFamily: "system", fontSize: 14,
        fontWeight: 400, textAlign: "left", letterSpacing: 0, lineHeight: 1.5,
        paddingX: 16, paddingY: 24, marginTop: 0, marginBottom: 0,
        borderColor: "transparent", borderWidth: 0, borderRadius: 0,
        buttonTextColor: "", buttonBackground: "transparent", buttonBorderColor: "", buttonBorderWidth: 1,
        buttonRadius: 0, buttonFontSize: 12, buttonFontWeight: 500
      };
      const typeDefaults = {
        hero: { height: 420, paddingX: 0, paddingY: 0, textAlign: "center", fontFamily: "luxury-serif", fontSize: 28, textColor: "#c9a97e", overlay: 40 },
        media: { height: 360, paddingX: 0, paddingY: 0, backgroundColor: "#ffffff", overlay: 0 },
        categories: { paddingX: 16, paddingY: 20, fontSize: 14 },
        "product-grid": { paddingX: 15, paddingY: 25, gap: 10, fontFamily: "system" },
        "member-banner": { paddingX: 18, paddingY: 28, textAlign: "center", fontFamily: "luxury-serif", backgroundColor: "#000000", textColor: "#ffffff" },
        "product-detail": { paddingX: 18, paddingY: 24, fontFamily: "system", fontSize: 14 },
        "appointment-hero": { paddingX: 24, paddingY: 28, fontFamily: "luxury-serif", backgroundColor: "#171717", textColor: "#ffffff" },
        "appointment-form": { paddingX: 16, paddingY: 20, backgroundColor: "#f4f3f0", textColor: "#171717" },
        "appointment-notes": { paddingX: 16, paddingY: 20, backgroundColor: "#ffffff", textColor: "#171717" },
        "appointment-submit": { paddingX: 16, paddingY: 20, backgroundColor: "#ffffff", textColor: "#171717" },
        text: { paddingX: 22, paddingY: 30, textAlign: "center", fontFamily: "luxury-serif", fontSize: 18 },
        spacer: { height: 30, paddingX: 0, paddingY: 0 }
      };
      return { ...common, ...global, ...(typeDefaults[type] || {}) };
    }

    function legacySectionStyleDefaults(type) {
      const common = {
        backgroundColor: "transparent", textColor: "", fontFamily: "system", fontSize: 14,
        fontWeight: 400, textAlign: "left", letterSpacing: 0, lineHeight: 1.5,
        paddingX: 16, paddingY: 24, marginTop: 0, marginBottom: 0,
        borderColor: "transparent", borderWidth: 0, borderRadius: 0,
        buttonTextColor: "", buttonBackground: "transparent", buttonBorderColor: "", buttonBorderWidth: 1,
        buttonRadius: 0, buttonFontSize: 12, buttonFontWeight: 500
      };
      const types = {
        hero: { height: 420, paddingX: 0, paddingY: 0, textAlign: "center", fontFamily: "luxury-serif", fontSize: 28, textColor: "#c9a97e", overlay: 40 },
        media: { height: 360, paddingX: 0, paddingY: 0, backgroundColor: "#ffffff", overlay: 0 },
        categories: { paddingX: 14, paddingY: 17, fontSize: 10 },
        "product-grid": { paddingX: 15, paddingY: 25, gap: 10, fontFamily: "system" },
        "member-banner": { paddingX: 18, paddingY: 28, textAlign: "center", fontFamily: "luxury-serif", backgroundColor: "#000000", textColor: "#ffffff" },
        "product-detail": { paddingX: 18, paddingY: 24, fontFamily: "system", fontSize: 14 },
        "appointment-hero": { paddingX: 24, paddingY: 28, fontFamily: "luxury-serif", backgroundColor: "#171717", textColor: "#ffffff" },
        "appointment-form": { paddingX: 16, paddingY: 20, backgroundColor: "#f4f3f0", textColor: "#171717" },
        "appointment-notes": { paddingX: 16, paddingY: 20, backgroundColor: "#ffffff", textColor: "#171717" },
        "appointment-submit": { paddingX: 16, paddingY: 20, backgroundColor: "#ffffff", textColor: "#171717" },
        text: { paddingX: 22, paddingY: 30, textAlign: "center", fontFamily: "luxury-serif", fontSize: 18 },
        spacer: { height: 30, paddingX: 0, paddingY: 0 }
      };
      return { ...common, ...(types[type] || {}) };
    }

    function normalizeSectionStyle(style = {}, type = "text", designSystem) {
      const defaults = sectionStyleDefaults(type, designSystem);
      const merged = { ...defaults, ...(style || {}) };
      const numeric = (value, fallback, min, max) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
      };
      merged.marginTop = numeric(merged.marginTop, defaults.marginTop, 0, 240);
      merged.marginBottom = numeric(merged.marginBottom, defaults.marginBottom, 0, 240);
      merged.paddingX = numeric(merged.paddingX, defaults.paddingX, 0, 120);
      merged.paddingY = numeric(merged.paddingY, defaults.paddingY, 0, 180);
      return merged;
    }

    function refreshStyleOverrides(section) {
      if (!section) return;
      const defaults = sectionStyleDefaults(section.type);
      const keys = new Set(Array.isArray(section.overrideKeys) ? section.overrideKeys : []);
      Object.keys(section.style || {}).forEach(key => {
        if (section.style[key] !== defaults[key]) keys.add(key);
        else keys.delete(key);
      });
      section.overrideKeys = [...keys];
    }

    function makeSlide(hero, index = 0) {
      return {
        id: makeId("slide"), kind: "image", src: hero?.img || "/images/hero1.jpg",
        title: hero?.title || "SUNGLASSES", subtitle: hero?.sub || "发现新世界",
        buttonText: "探索更多", showContent: true, showButton: true, linkType: "page", linkValue: "/pages/category/category",
        duration: 5, poster: "", order: index, hotspots: []
      };
    }

    function makeSection(type, name, props = {}, style = {}) {
      return {
        id: makeId(type), type, name, enabled: true, props,
        style: normalizeSectionStyle(style, type),
        visibility: { mobile: true, tablet: true, desktop: true }
      };
    }

    function pagePreset(pageId, data) {
      const firstHero = data.heroes?.[0];
      const campaignHero = data.heroes?.[1] || firstHero;
      if (pageId === "category") return [
        makeSection("text", "分类页标题", { title: "分类", text: "按系列浏览商品" }, { paddingY: 22 }),
        makeSection("categories", "分类导航", { count: Math.min(8, data.categories.length) }),
        makeSection("product-grid", "全部商品", { title: "全部商品", category: "all", columns: 2, count: 8, showName: true, showPrice: true })
      ];
      if (pageId === "campaign") return [
        makeSection("hero", "系列主视觉", { slides: [makeSlide(campaignHero)], autoplay: false, interval: 5, transition: "fade" }, { height: 360 }),
        makeSection("text", "系列说明", { title: "LAKE MAGGIORE", text: "从湖光与建筑线条中汲取灵感，呈现松弛而克制的夏日衣橱。" }),
        makeSection("product-grid", "系列商品", { title: "系列精选", category: "summer", columns: 2, count: 6, showName: true, showPrice: true })
      ];
      if (pageId === "cart") return [
        makeSection("text", "购物车标题", { title: "购物车", text: "已选商品会安全保留，可继续探索或前往结算。" }, { paddingY: 34 }),
        makeSection("product-grid", "为你推荐", { title: "为你推荐", category: "all", columns: 2, count: 4, showName: true, showPrice: true })
      ];
      if (pageId === "mine") return [
        makeSection("member-banner", "会员中心", { title: data.brand.name || "PRIVLAN", subtitle: data.brand.slogan || "成为会员，享受更多礼遇" }),
        makeSection("text", "专属服务", { title: "专属服务", text: "订单、收藏、礼遇与专属顾问均可在这里查看。" }),
        makeSection("product-grid", "最近浏览", { title: "最近浏览", category: "all", columns: 2, count: 4, showName: true, showPrice: true })
      ];
      if (pageId === "detail") return [
        makeSection("product-detail", "商品详情", { productId: data.products?.[0]?.id || 1, showPrice: true, showActions: true }),
        makeSection("text", "商品说明", { title: "匠心细节", text: "精选材质与精准剪裁，在日常穿着中呈现克制而持久的质感。" }),
        makeSection("product-grid", "相关推荐", { title: "相关推荐", category: "all", columns: 2, count: 4, showName: true, showPrice: true })
      ];
      if (pageId === "appointment") return [
        makeSection("appointment-hero", "预约页头图", { kicker: "PRIVLAN APPOINTMENT", title: "预约专属服务", description: "选择适合你的门店、时间和顾问，我们会提前做好准备。" }, { backgroundColor: "#171717", textColor: "#ffffff", paddingX: 24, paddingY: 28, fontFamily: "luxury-serif" }),
        makeSection("appointment-form", "预约信息与服务", { showName: true, showPhone: true, showService: true, showStore: true, showDate: true, showTime: true, showAdvisor: true }),
        makeSection("appointment-notes", "到店备注", { label: "到店备注", placeholder: "可填写想了解的款式、场合或其他需求" }),
        makeSection("appointment-submit", "提交预约", { buttonText: "确认预约", successTitle: "预约已提交", successCopy: "我们会尽快确认你的预约，请留意顾问联系。" })
      ];
      return [];
    }

    function normalizeConfig(data) {
      const previousDesignVersion = Number(data.designSystem?.version || 1);
      data.brand ||= { name: "PRIVLAN", slogan: "成为会员，享受更多礼遇" };
      data.theme ||= {};
      data.theme.colors ||= {
        bgPrimary: "#0a0a0a", bgSecondary: "#161616", bgTertiary: "#1e1e1e",
        textPrimary: "#f0f0f0", textSecondary: "#8a8a8a", accent: "#c9a97e", border: "#2a2a2a"
      };
      data.heroes ||= [];
      data.categories ||= [];
      data.products = (Array.isArray(data.products) ? data.products : []).map(normalizeProduct);
      const benefitDefaults = [
        { linkType: "page", linkValue: "/pages/category/category?cat=new" },
        { linkType: "page", linkValue: "/pages/service-chat/index" },
        { linkType: "page", linkValue: "/pages/appointment/index" },
        { linkType: "page", linkValue: "/pages/mine/mine" }
      ];
      data.memberBenefits = (Array.isArray(data.memberBenefits) ? data.memberBenefits : []).map((benefit, index) => ({
        ...benefit,
        linkType: benefit?.linkType || benefitDefaults[index]?.linkType || "page",
        linkValue: benefit?.linkValue || benefitDefaults[index]?.linkValue || "/pages/mine/mine"
      }));
      normalizeTabBar(data);
      if (!Array.isArray(data.homeChannels)) data.homeChannels = ["推荐", "LAKE MAGGIORE"];
      data.homeChannels = data.homeChannels.map(channel => String(channel || "").trim()).filter(Boolean).slice(0, 5);
      if (!data.homeChannels.length) data.homeChannels = ["推荐"];
      const serviceBot = data.serviceBot || {};
      data.serviceBot = {
        enabled: serviceBot.enabled !== false,
        icon: serviceBot.icon || "/images/icon-headset.png",
        size: clamp(serviceBot.size ?? 88, 64, 120),
        right: clamp(serviceBot.right ?? 24, 8, 300),
        bottom: clamp(serviceBot.bottom ?? 150, 112, 700),
        welcomeMessage: String(serviceBot.welcomeMessage || "您好，我是 PRIVLAN 专属服务助手。请问今天想了解什么？").slice(0, 160),
        quickPrompts: (Array.isArray(serviceBot.quickPrompts) ? serviceBot.quickPrompts : ["我要预约", "你们的价格区间是多少？", "你们用的什么面料？", "版型与款式", "制作周期多久？", "转人工服务"]).map(value => String(value || "")).slice(0, 8),
        answerProvider: "rules",
        humanServiceEnabled: serviceBot.humanServiceEnabled === true,
        authMode: serviceBot.authMode === "wechat" ? "wechat" : "test"
      };
      data.customFonts ||= [];
      if (!Array.isArray(data.customPages)) data.customPages = [];
      const existingDesignSystem = data.designSystem || {};
      data.designSystem = {
        ...existingDesignSystem,
        version: 2,
        blockDefaults: {
          fontFamily: "system", fontWeight: 400, lineHeight: 1.55,
          ...(existingDesignSystem.blockDefaults || {})
        },
        typography: {
          caption: 12, meta: 13, body: 14, panelTitle: 16, pageTitle: 20, display: 28,
          bodyLineHeight: 1.55, displayLineHeight: 1.3,
          ...(existingDesignSystem.typography || {})
        },
        miniProgramTypography: {
          caption: 22, meta: 24, body: 28, sectionTitle: 34, pageTitle: 42, heroTitle: 54,
          bodyLineHeight: 1.65, headingLineHeight: 1.3,
          ...(existingDesignSystem.miniProgramTypography || {})
        },
        spacing: {
          unit: 4, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, section: 48,
          ...(existingDesignSystem.spacing || {})
        },
        surfaces: {
          radius: 8, shadow: "0 12px 36px rgba(31,30,27,.08)",
          ...(existingDesignSystem.surfaces || {})
        }
      };
      data.pageLayouts ||= {};
      if (!Array.isArray(data.pageLayouts.home)) {
      data.pageLayouts.home = [
          { id: "hero-main", type: "hero", name: "首屏轮播", enabled: true, props: { heroIndex: 0, showButton: true, buttonText: "探索更多" }, style: { height: 350 }, visibility: { mobile: true, tablet: true, desktop: true } },
          { id: "categories-main", type: "categories", name: "分类导航", enabled: true, props: { count: 5 }, style: {}, visibility: { mobile: true, tablet: true, desktop: true } },
          { id: "products-new", type: "product-grid", name: "早秋新品", enabled: true, props: { title: "早秋新品", category: "new", columns: 3, count: 6, showName: true, showPrice: true }, style: { paddingX: 15, paddingY: 25, gap: 10 }, visibility: { mobile: true, tablet: true, desktop: true } },
          { id: "member-main", type: "member-banner", name: "会员权益", enabled: true, props: { title: data.brand.name || "PRIVLAN", subtitle: data.brand.slogan || "成为会员，享受更多礼遇" }, style: {}, visibility: { mobile: true, tablet: true, desktop: true } }
        ];
      }
      data.appointment ||= {};
      data.appointment = {
        kicker: "PRIVLAN APPOINTMENT",
        title: "预约专属服务",
        description: "选择适合你的门店、时间和顾问，我们会提前做好准备。",
        submitText: "确认预约",
        successTitle: "预约已提交",
        successCopy: "我们会尽快确认你的预约，请留意顾问联系。",
        fields: { name: true, phone: true, service: true, store: true, date: true, time: true, advisor: true, notes: true },
        ...(data.appointment || {}),
        fields: { name: true, phone: true, service: true, store: true, date: true, time: true, advisor: true, notes: true, ...(data.appointment?.fields || {}) }
      };
      [...builtInPages, ...data.customPages].filter(page => page.id !== "home").forEach(page => {
        if (!Array.isArray(data.pageLayouts[page.id])) data.pageLayouts[page.id] = pagePreset(page.id, data);
      });
      Object.values(data.pageLayouts).flat().forEach(section => {
        section.props ||= {};
        const rawStyle = section.style || {};
        const legacyDefaults = legacySectionStyleDefaults(section.type);
        section.overrideKeys = Array.isArray(section.overrideKeys)
          ? section.overrideKeys
          : Object.keys(rawStyle).filter(key => rawStyle[key] !== legacyDefaults[key]);
        if (previousDesignVersion < 2) {
          const migratedStyle = sectionStyleDefaults(section.type, data.designSystem);
          section.overrideKeys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(rawStyle, key)) migratedStyle[key] = rawStyle[key];
          });
          section.style = normalizeSectionStyle(migratedStyle, section.type, data.designSystem);
        } else {
          section.style = normalizeSectionStyle(section.style, section.type, data.designSystem);
        }
        section.visibility ||= { mobile: true, tablet: true, desktop: true };
        if (section.enabled === undefined) section.enabled = true;
        if (section.type === "hero") {
          if (!Array.isArray(section.props.slides) || !section.props.slides.length) {
            section.props.slides = (data.heroes.length ? data.heroes : [null]).map((hero, index) => makeSlide(hero, index));
          }
          section.props.slides = section.props.slides.map((slide, index) => ({
            id: slide.id || makeId("slide"), kind: slide.kind || "image", src: slide.src || slide.img || "/images/hero1.jpg",
            title: slide.title || "", subtitle: slide.subtitle ?? slide.sub ?? "", buttonText: slide.buttonText || section.props.buttonText || "探索更多",
            showContent: slide.showContent ?? true, showButton: slide.showButton ?? section.props.showButton ?? true, linkType: slide.linkType || "page",
            linkValue: slide.linkValue || "/pages/category/category", duration: Number(slide.duration || 5), poster: slide.poster || "", order: index,
            hotspots: (Array.isArray(slide.hotspots) ? slide.hotspots : []).map(normalizeHotspot)
          }));
          section.props.autoplay ??= true;
          section.props.interval ??= 5;
          section.props.transition ??= "fade";
        }
        if (section.type === "media") {
          section.props = { mode: "color", src: "", fit: "cover", position: "center", overlay: 0, autoplay: true, loop: true, muted: true, controls: false, linkType: "", linkValue: "", hotspots: [], ...section.props };
          section.props.hotspots = (Array.isArray(section.props.hotspots) ? section.props.hotspots : []).map(normalizeHotspot);
        }
        if (section.type !== "hero" && section.type !== "media") {
          section.props.hotspots = (Array.isArray(section.props.hotspots) ? section.props.hotspots : []).map(normalizeHotspot);
        }
      });
      installCustomFonts(data.customFonts);
      return data;
    }

    function installCustomFonts(fonts = []) {
      let style = document.getElementById("privlan-custom-fonts");
      if (!style) { style = document.createElement("style"); style.id = "privlan-custom-fonts"; document.head.appendChild(style); }
      style.textContent = fonts.filter(font => font.url).map(font => `@font-face{font-family:"${font.id}";src:url("${font.url.replace(/^\/fonts\//, "/mp-fonts/")}") format("${font.format || "woff2"}");font-display:swap;}`).join("\n");
    }

    async function loadConfig() {
      loading.value = true;
      loadError.value = "";
      try {
        const response = await fetch("/api/config");
        if (!response.ok) throw new Error(`读取配置失败（${response.status}）`);
        const rawConfig = await response.json();
        const rawSnapshot = JSON.stringify(rawConfig);
        cfg.value = normalizeConfig(rawConfig);
        selectedId.value = sections.value[2]?.id || sections.value[0]?.id || null;
        savedSnapshot.value = JSON.stringify(cfg.value);
        history.value = [savedSnapshot.value];
        historyIndex.value = 0;
        if (rawSnapshot !== savedSnapshot.value) {
          await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: savedSnapshot.value });
        }
        loadSystemFonts();
      } catch (error) {
        loadError.value = error.message || "无法读取配置";
        saveMode.value = "error";
      } finally {
        loading.value = false;
      }
    }

    watch(cfg, () => {
      if (!cfg.value || restoring.value || loading.value) return;
      saveMode.value = "dirty";
      clearTimeout(historyTimer);
      historyTimer = setTimeout(() => {
        const snapshot = JSON.stringify(cfg.value);
        if (snapshot === history.value[historyIndex.value]) return;
        history.value = history.value.slice(0, historyIndex.value + 1);
        history.value.push(snapshot);
        if (history.value.length > 40) history.value.shift();
        historyIndex.value = history.value.length - 1;
      }, 380);
    }, { deep: true });
    watch(selectedId, () => { selectedSlideIndex.value = 0; selectedHotspotId.value = null; hotspotEditMode.value = false; });
    watch(() => selectedSection.value?.style, () => {
      if (!selectedSection.value || loading.value || restoring.value) return;
      refreshStyleOverrides(selectedSection.value);
    }, { deep: true });
    watch(() => cfg.value.customFonts, fonts => installCustomFonts(fonts || []), { deep: true });

    function restoreHistory(index) {
      const snapshot = history.value[index];
      if (!snapshot) return;
      restoring.value = true;
      cfg.value = normalizeConfig(JSON.parse(snapshot));
      historyIndex.value = index;
      if (!sections.value.some(s => s.id === selectedId.value)) selectedId.value = sections.value[0]?.id || null;
      nextTick(() => { restoring.value = false; saveMode.value = isDirty.value ? "dirty" : "saved"; });
    }

    function undo() { if (canUndo.value) restoreHistory(historyIndex.value - 1); }
    function redo() { if (canRedo.value) restoreHistory(historyIndex.value + 1); }

    function toast(title, message = "", type = "success") {
      const item = { id: Date.now() + Math.random(), title, message, type };
      toasts.push(item);
      setTimeout(() => {
        const index = toasts.findIndex(t => t.id === item.id);
        if (index >= 0) toasts.splice(index, 1);
      }, 3600);
    }

    async function saveConfig(silent = false) {
      if (!cfg.value) return false;
      Object.values(cfg.value.pageLayouts || {}).flat().forEach(section => {
        section.style = normalizeSectionStyle(section.style, section.type);
        refreshStyleOverrides(section);
      });
      saveMode.value = "saving";
      try {
        const response = await fetch("/api/config", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg.value)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `保存失败（${response.status}）`);
        savedSnapshot.value = JSON.stringify(cfg.value);
        saveMode.value = "saved";
        if (!silent) toast("已保存", "所有更改已写入 config.json");
        return true;
      } catch (error) {
        saveMode.value = "error";
        toast("保存失败", error.message, "error");
        return false;
      }
    }

    async function syncProject() {
      if (!cfg.value) return false;
      saveMode.value = "syncing";
      try {
        const response = await fetch("/api/sync", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg.value)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `同步失败（${response.status}）`);
        cfg.value._lastSync = result.lastSync;
        savedSnapshot.value = JSON.stringify(cfg.value);
        saveMode.value = "saved";
        toast("同步完成", `已更新 ${result.files?.length || 0} 项小程序文件`);
        return true;
      } catch (error) {
        saveMode.value = "error";
        toast("同步失败", error.message, "error");
        return false;
      }
    }

    async function openPhonePreview() {
      if (!cfg.value || previewDialog.state === "syncing" || previewDialog.state === "generating") return;
      previewDialog.open = true;
      previewDialog.state = "syncing";
      previewDialog.qrUrl = "";
      previewDialog.error = "";

      if (!await syncProject()) {
        previewDialog.state = "error";
        previewDialog.error = "同步未完成，无法生成与当前设计一致的预览二维码。";
        return;
      }

      previewDialog.state = "generating";
      try {
        const response = await fetch("/api/preview", { method: "POST" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok || !result.qrUrl) throw new Error(result.error || `预览二维码生成失败（${response.status}）`);
        previewDialog.qrUrl = result.qrUrl;
        previewDialog.state = "ready";
      } catch (error) {
        previewDialog.state = "error";
        previewDialog.error = error.message || "二维码生成失败，请重试。";
      }
    }

    function closePhonePreview() {
      previewDialog.open = false;
    }

    function serviceBotClick() {
      if (serviceBotSuppressClick.value) {
        serviceBotSuppressClick.value = false;
        return;
      }
      if (!servicePreview.messages.length) servicePreview.messages.push(previewServiceMessage("assistant", cfg.value.serviceBot.welcomeMessage));
      servicePreview.screen = "chat";
      servicePreview.open = true;
    }

    function previewServiceMessage(role, text, extra = {}) {
      return { id: Date.now() + Math.random(), role, text, ...extra };
    }

    function closeServicePreview() {
      servicePreview.open = false;
      servicePreview.screen = "chat";
      servicePreview.draft = "";
      servicePreview.appointmentDone = false;
    }

    function previewServicePrompt(text) {
      const question = String(text || servicePreview.draft || "").trim();
      if (!question || servicePreview.sending) return;
      servicePreview.draft = "";
      servicePreview.messages.push(previewServiceMessage("user", question));
      if (/预约/.test(question)) {
        servicePreview.messages.push(previewServiceMessage("assistant", "可以。请选择门店、日期、时间与顾问。", { action: "appointment" }));
      } else if (/量体|尺寸/.test(question)) {
        servicePreview.messages.push(previewServiceMessage("assistant", "预览模式不会读取真实客户资料。真机验证身份后，可查看肩宽、胸围、腰围等完整量体数据。", { action: "measurements" }));
      } else if (/人工/.test(question)) {
        servicePreview.messages.push(previewServiceMessage("assistant", cfg.value.serviceBot.humanServiceEnabled ? "真机中将打开微信原生客服。" : "微信原生客服尚未开通，请在公众平台开通后再启用。", { action: "human" }));
      } else if (/价格/.test(question)) {
        servicePreview.messages.push(previewServiceMessage("assistant", "价格会根据品类、面料和定制需求确定，品牌顾问会提供对应区间。"));
      } else if (/面料/.test(question)) {
        servicePreview.messages.push(previewServiceMessage("assistant", "我们会根据季节、场景和版型选择适合的天然及高品质混纺面料。"));
      } else if (/版型|款式/.test(question)) {
        servicePreview.messages.push(previewServiceMessage("assistant", "PRIVLAN 注重克制轮廓与合体剪裁，顾问会结合身形与场合提供建议。"));
      } else if (/周期|多久/.test(question)) {
        servicePreview.messages.push(previewServiceMessage("assistant", "完成量体和款式确认后，顾问会根据面料与工艺给出准确交付时间。"));
      } else {
        servicePreview.messages.push(previewServiceMessage("assistant", "这个问题需要品牌顾问进一步确认，你可以补充具体品类和需求。"));
      }
      nextTick(() => { const list = document.querySelector(".preview-service-messages"); if (list) list.scrollTop = list.scrollHeight; });
    }

    function openPreviewAppointment() {
      closeServicePreview();
      switchPage("appointment");
    }

    function submitPreviewAppointment() {
      servicePreview.appointmentDone = true;
    }

    function beginServiceBotDrag(event) {
      if (device.value === "desktop" || cfg.value?.serviceBot?.enabled === false) return;
      const point = event.touches?.[0] || event;
      serviceBotDrag.active = true;
      serviceBotDrag.pointerId = event.pointerId ?? null;
      serviceBotDrag.startX = point.clientX;
      serviceBotDrag.startY = point.clientY;
      serviceBotDrag.startRight = Number(cfg.value.serviceBot.right) || 24;
      serviceBotDrag.startBottom = Number(cfg.value.serviceBot.bottom) || 150;
      serviceBotDrag.moved = false;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }

    function moveServiceBotDrag(event) {
      if (!serviceBotDrag.active || (serviceBotDrag.pointerId !== null && serviceBotDrag.pointerId !== event.pointerId)) return;
      const point = event.touches?.[0] || event;
      const distance = Math.hypot(point.clientX - serviceBotDrag.startX, point.clientY - serviceBotDrag.startY);
      if (distance >= 8) serviceBotDrag.moved = true;
      if (!serviceBotDrag.moved) return;
      const scale = 390 / 750;
      const size = (Number(cfg.value.serviceBot.size) || 88) * scale;
      const designWidth = 390;
      const designHeight = 720;
      const rightPx = clamp(serviceBotDrag.startRight * scale - (point.clientX - serviceBotDrag.startX), 8 * scale, Math.max(8 * scale, designWidth * scale - size - 8 * scale));
      const bottomPx = clamp(serviceBotDrag.startBottom * scale - (point.clientY - serviceBotDrag.startY), 112 * scale, Math.max(112 * scale, designHeight * scale - size - 72 * scale));
      cfg.value.serviceBot.right = Math.round(rightPx / scale);
      cfg.value.serviceBot.bottom = Math.round(bottomPx / scale);
      if (serviceBotDrag.moved) serviceBotSuppressClick.value = true;
      event.preventDefault();
    }

    function endServiceBotDrag(event) {
      if (!serviceBotDrag.active || (serviceBotDrag.pointerId !== null && serviceBotDrag.pointerId !== event.pointerId)) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      serviceBotDrag.active = false;
      serviceBotDrag.pointerId = null;
    }

    function switchView(id) {
      currentView.value = id;
      if (id === "media" && !media.value.length) loadMedia();
    }

    function togglePanel(side) {
      if (side === "left") leftPanelOpen.value = !leftPanelOpen.value;
      if (side === "right") rightPanelOpen.value = !rightPanelOpen.value;
      try {
        localStorage.setItem("privlan:left-panel", leftPanelOpen.value ? "open" : "closed");
        localStorage.setItem("privlan:right-panel", rightPanelOpen.value ? "open" : "closed");
      } catch (error) { /* storage is optional */ }
    }

    function openNewPage() {
      newPage.name = "";
      newPage.slug = "";
      newPage.error = "";
      newPage.open = true;
      nextTick(() => document.querySelector("#new-page-name")?.focus());
    }

    function openHomeNavigation() {
      if (!Array.isArray(cfg.value.homeChannels) || !cfg.value.homeChannels.length) cfg.value.homeChannels = ["推荐"];
      homeNavOpen.value = true;
    }

    function addHomeChannel() {
      if (cfg.value.homeChannels.length >= 5) {
        toast("最多 5 个频道", "避免首页顶部导航在手机上拥挤", "error");
        return;
      }
      cfg.value.homeChannels.push("新频道");
    }

    function moveHomeChannel(index, delta) {
      const target = index + delta;
      if (target < 0 || target >= cfg.value.homeChannels.length) return;
      const [channel] = cfg.value.homeChannels.splice(index, 1);
      cfg.value.homeChannels.splice(target, 0, channel);
    }

    function removeHomeChannel(index) {
      if (cfg.value.homeChannels.length <= 1) {
        toast("至少保留一个频道", "首页导航需要至少一个入口", "error");
        return;
      }
      cfg.value.homeChannels.splice(index, 1);
    }

    function finishHomeNavigation() {
      cfg.value.homeChannels = cfg.value.homeChannels.map(channel => String(channel || "").trim()).filter(Boolean).slice(0, 5);
      if (!cfg.value.homeChannels.length) cfg.value.homeChannels = ["推荐"];
      homeNavOpen.value = false;
    }

    function normalizePageSlug(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/^\/?pages\//, "")
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-+/g, "-");
    }

    function createBlankPage() {
      const name = newPage.name.trim();
      if (!name) {
        newPage.error = "请填写页面名称";
        return;
      }
      let slug = normalizePageSlug(newPage.slug) || `page-${Date.now().toString(36)}`;
      slug = slug.replace(/^custom-/, "") || `page-${Date.now().toString(36)}`;
      let id = `custom-${slug}`;
      let suffix = 2;
      while (pageDefinitions.value.some(page => page.id === id)) id = `custom-${slug}-${suffix++}`;
      const page = { id, name, path: `/pages/${id}/${id}`, tab: false, icon: "ph:file-text", custom: true };
      cfg.value.customPages.push(page);
      cfg.value.pageLayouts[id] = [];
      newPage.open = false;
      switchPage(id);
      toast("空白页面已创建", `${name} · 现在可以从左侧添加区块`);
    }

    function switchPage(id) {
      if (!pageDefinitions.value.some(page => page.id === id)) return;
      currentPage.value = id;
      selectedId.value = sections.value[0]?.id || null;
      selectedSlideIndex.value = 0;
      inspectorTab.value = "content";
    }

    function navigatePreview(target) {
      const value = target?.linkValue || target?.path || "";
      if (target?.linkType === "external") { toast("网页链接", value || "尚未设置跳转地址"); return; }
      if (value.startsWith("/pages/service-chat/")) {
        serviceBotClick();
        return;
      }
      const page = pageDefinitions.value.find(item => value.startsWith(item.path));
      if (!page) { toast("未找到目标页面", value || "请先选择跳转目标", "error"); return; }
      if (page.id === "detail") {
        const productId = Number(new URLSearchParams(value.split("?")[1] || "").get("id"));
        const detail = cfg.value.pageLayouts.detail?.find(section => section.type === "product-detail");
        if (detail && productId) detail.props.productId = productId;
      }
      switchPage(page.id);
    }

    function blockLabel(section) {
      return section.name || ({ hero: "首屏轮播", media: "媒体背景", categories: "分类导航", "product-grid": "商品列表", "member-banner": "会员权益", "product-detail": "商品详情", "appointment-hero": "预约页头图", "appointment-form": "预约表单", "appointment-notes": "预约备注", "appointment-submit": "预约提交", text: "图文标题", spacer: "留白" })[section.type] || "页面区块";
    }

    function addBlock(type, afterIndex = sections.value.length - 1) {
      const base = { id: makeId(type), type, enabled: true, props: {}, style: sectionStyleDefaults(type), visibility: { mobile: true, tablet: true, desktop: true } };
      if (type === "hero") Object.assign(base, { name: "首屏轮播", props: { slides: (cfg.value.heroes.length ? cfg.value.heroes : [null]).map((hero, index) => makeSlide(hero, index)), autoplay: true, interval: 5, transition: "fade" } });
      if (type === "media") Object.assign(base, { name: "媒体背景", props: { mode: "color", src: "", fit: "cover", position: "center", overlay: 0, autoplay: true, loop: true, muted: true, controls: false, linkType: "", linkValue: "", hotspots: [] } });
      if (type === "categories") Object.assign(base, { name: "分类导航", props: { count: 5 } });
      if (type === "product-grid") Object.assign(base, { name: "商品列表", props: { title: "精选商品", category: "all", columns: 3, count: 6, showName: true, showPrice: true } });
      if (type === "member-banner") Object.assign(base, { name: "会员权益", props: { useBrandLogo: true, title: cfg.value.brand.name, subtitle: cfg.value.brand.slogan } });
      if (type === "product-detail") Object.assign(base, { name: "商品详情", props: { productId: cfg.value.products[0]?.id || 1, showPrice: true, showActions: true } });
      if (type === "appointment-hero") Object.assign(base, { name: "预约页头图", props: { kicker: "PRIVLAN APPOINTMENT", title: "预约专属服务", description: "选择适合你的服务和时间，我们会提前做好准备。" } });
      if (type === "appointment-form") Object.assign(base, { name: "预约表单", props: { showName: true, showPhone: true, showService: true, showStore: true, showDate: true, showTime: true, showAdvisor: true } });
      if (type === "appointment-notes") Object.assign(base, { name: "预约备注", props: { label: "到店备注", placeholder: "可填写想了解的款式、场合或其他需求" } });
      if (type === "appointment-submit") Object.assign(base, { name: "预约提交", props: { buttonText: "确认预约", successTitle: "预约已提交", successCopy: "我们会尽快确认你的预约，请留意顾问联系。" } });
      if (type === "text") Object.assign(base, { name: "图文标题", props: { title: "品牌故事", text: "在这里输入一段简洁有力的品牌或活动说明。" } });
      if (type === "spacer") Object.assign(base, { name: "留白" });
      sections.value.splice(afterIndex + 1, 0, base);
      selectedId.value = base.id;
      selectedSlideIndex.value = 0;
      inspectorTab.value = "content";
      blockQuickAddOpen.value = false;
      toast("已添加区块", blockLabel(base));
    }

    function sectionIndex(id) { return sections.value.findIndex(s => s.id === id); }
    function moveSection(id, delta) {
      const index = sectionIndex(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= sections.value.length) return;
      const [item] = sections.value.splice(index, 1);
      sections.value.splice(target, 0, item);
    }
    function duplicateSection(id) {
      const index = sectionIndex(id);
      if (index < 0) return;
      const copy = JSON.parse(JSON.stringify(sections.value[index]));
      copy.id = makeId(copy.type);
      copy.name = `${blockLabel(copy)} 副本`;
      sections.value.splice(index + 1, 0, copy);
      selectedId.value = copy.id;
    }
    function deleteSection(id) {
      const index = sectionIndex(id);
      if (index < 0) return;
      sections.value.splice(index, 1);
      selectedId.value = sections.value[Math.min(index, sections.value.length - 1)]?.id || null;
      toast("区块已删除", "可使用撤销恢复", "success");
    }
    function toggleSection(section) { section.enabled = !section.enabled; }

    function previewHero(section) {
      const slides = section?.props?.slides || [];
      return slides[selectedSlideIndex.value] || slides[0] || makeSlide(cfg.value.heroes[0]);
    }
    function sectionProducts(section) {
      const category = section.props.category || "all";
      const list = category === "all" ? cfg.value.products : cfg.value.products.filter(p => p.cat === category);
      return list.slice(0, Number(section.props.count || 6));
    }
    function detailProduct(section) {
      return cfg.value.products.find(product => Number(product.id) === Number(section.props.productId)) || cfg.value.products[0] || {};
    }
    function loadCart() {
      try {
        const saved = JSON.parse(localStorage.getItem("privlan-cart") || "[]");
        cart.value = Array.isArray(saved) ? saved.filter(item => item?.id && item.quantity > 0) : [];
      } catch (error) {
        cart.value = [];
      }
    }
    function persistCart() {
      localStorage.setItem("privlan-cart", JSON.stringify(cart.value));
    }
    function addToCart(product, openCart = false) {
      if (!product?.id) return;
      const existing = cart.value.find(item => Number(item.id) === Number(product.id));
      if (existing) existing.quantity += 1;
      else cart.value.push({ id: product.id, name: product.name || "商品", price: Number(product.price) || 0, img: product.img || "", quantity: 1 });
      persistCart();
      toast("已加入购物车", `${product.name || "商品"} 已加入，购物车共 ${cartSummary.value.quantity} 件`);
      if (openCart) switchPage("cart");
    }
    function changeCartQuantity(id, delta) {
      const item = cart.value.find(line => Number(line.id) === Number(id));
      if (!item) return;
      item.quantity = Math.max(0, Number(item.quantity || 0) + Number(delta || 0));
      cart.value = cart.value.filter(line => line.quantity > 0);
      persistCart();
    }
    function productImages(product) {
      const images = Array.isArray(product?.gallery) ? product.gallery : [];
      return [...images, product?.img].filter((path, index, list) => path && list.indexOf(path) === index).slice(0, 5);
    }
    function mpUrl(path) { return path ? path.replace(/^\/images\//, "/mp-images/").replace(/^\/fonts\//, "/mp-fonts/") : ""; }
    function money(value) { return `¥${Number(value || 0).toLocaleString("zh-CN")}`; }
    function categoryName(id) { return cfg.value?.categories.find(c => c.id === id)?.name || id || "未分类"; }
    function fontStack(id) { return fontOptions.value.find(font => font.id === id)?.stack || fontPresets[0].stack; }
    function sectionStyle(section) {
      const style = normalizeSectionStyle(section.style, section.type);
      const result = {
        backgroundColor: style.backgroundColor === "transparent" ? "transparent" : style.backgroundColor,
        color: style.textColor || "inherit", fontFamily: fontStack(style.fontFamily), fontSize: `${style.fontSize || 14}px`,
        fontWeight: style.fontWeight || 400, textAlign: style.textAlign || "left", letterSpacing: `${style.letterSpacing || 0}px`,
        lineHeight: style.lineHeight || 1.5, marginTop: `${style.marginTop || 0}px`, marginBottom: `${style.marginBottom || 0}px`,
        border: `${style.borderWidth || 0}px solid ${style.borderColor || "transparent"}`, borderRadius: `${style.borderRadius || 0}px`,
        "--section-text": style.textColor || "var(--page-text)", "--section-font": fontStack(style.fontFamily),
        "--section-font-size": `${style.fontSize || 14}px`, "--button-text": style.buttonTextColor || "var(--page-accent)",
        "--button-bg": style.buttonBackground || "transparent", "--button-border": style.buttonBorderColor || "var(--page-accent)",
        "--button-border-width": `${style.buttonBorderWidth ?? 1}px`, "--button-radius": `${style.buttonRadius || 0}px`,
        "--button-font-size": `${style.buttonFontSize || 12}px`, "--overlay-opacity": Number(style.overlay ?? 40) / 100
      };
      if (section.type === "appointment-hero" && section.props?.backgroundSrc) {
        result.backgroundImage = `url("${mpUrl(section.props.backgroundSrc)}")`;
        result.backgroundSize = section.props.backgroundFit || "cover";
        result.backgroundPosition = section.props.backgroundPosition || "center";
      }
      if (section.type === "spacer" || section.type === "media") result.height = `${style.height || (section.type === "media" ? 360 : 30)}px`;
      else result.padding = `${style.paddingY || 0}px ${style.paddingX || 0}px`;
      return result;
    }

    function resetSectionStyle(section = selectedSection.value) {
      if (!section) return;
      section.style = sectionStyleDefaults(section.type);
      section.overrideKeys = [];
      toast("已恢复全局默认", `${blockLabel(section)} 的独立样式已清除`);
    }

    function selectHeroSlide(index) {
      selectedSlideIndex.value = Math.max(0, index);
      selectedHotspotId.value = null;
    }
    function updateHeroLinkType(slide) {
      if (!slide) return;
      if (slide.linkType === "page") slide.linkValue = pageDefinitions.value.find(page => page.id !== currentPage.value)?.path || pageDefinitions.value[0].path;
      if (slide.linkType === "product") slide.linkValue = `/pages/detail/detail?id=${cfg.value.products[0]?.id || 1}`;
      if (slide.linkType === "category") slide.linkValue = `/pages/category/category?cat=${cfg.value.categories[0]?.id || "all"}`;
      if (slide.linkType === "external") slide.linkValue = "https://";
    }

    function hotspotStyle(hotspot) {
      const normalized = normalizeHotspot(hotspot);
      return { left: `${normalized.x}%`, top: `${normalized.y}%`, width: `${normalized.width}%`, height: `${normalized.height}%` };
    }

    function normalizeHotspotInPlace(hotspot) {
      if (!hotspot) return;
      Object.assign(hotspot, normalizeHotspot(hotspot));
    }

    function addHotspot(owner = hotspotOwner.value, position = {}) {
      if (!owner) return;
      owner.hotspots ||= [];
      const hotspot = normalizeHotspot({
        label: `热区 ${owner.hotspots.length + 1}`,
        x: position.x ?? 35, y: position.y ?? 41,
        width: position.width ?? 30, height: position.height ?? 18
      }, owner.hotspots.length);
      owner.hotspots.push(hotspot);
      selectedHotspotId.value = hotspot.id;
      hotspotEditMode.value = true;
      return hotspot;
    }

    function removeHotspot(hotspot = selectedHotspot.value) {
      if (!hotspotOwner.value || !hotspot) return;
      const index = hotspotOwner.value.hotspots.findIndex(item => item.id === hotspot.id);
      if (index < 0) return;
      hotspotOwner.value.hotspots.splice(index, 1);
      selectedHotspotId.value = hotspotOwner.value.hotspots[index]?.id || hotspotOwner.value.hotspots[index - 1]?.id || null;
      toast("点击热区已删除", hotspot.label);
    }

    function updateHotspotLinkType(hotspot) {
      updateHeroLinkType(hotspot);
    }

    function trackHotspotPointer(event, hotspot, action, surface, start) {
      const rect = surface.getBoundingClientRect();
      const move = moveEvent => {
        const dx = (moveEvent.clientX - event.clientX) / rect.width * 100;
        const dy = (moveEvent.clientY - event.clientY) / rect.height * 100;
        if (action === "move") {
          hotspot.x = Math.round(clamp(start.x + dx, 0, 100 - start.width) * 10) / 10;
          hotspot.y = Math.round(clamp(start.y + dy, 0, 100 - start.height) * 10) / 10;
        } else {
          hotspot.width = Math.round(clamp(start.width + dx, 4, 100 - start.x) * 10) / 10;
          hotspot.height = Math.round(clamp(start.height + dy, 4, 100 - start.y) * 10) / 10;
        }
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end, { once: true });
    }

    function beginHotspotPointer(event, hotspot, action = "move") {
      if (!hotspotEditMode.value) return;
      event.preventDefault();
      selectedHotspotId.value = hotspot.id;
      const surface = event.currentTarget.closest(".hotspot-surface");
      if (!surface) return;
      trackHotspotPointer(event, hotspot, action, surface, { x: hotspot.x, y: hotspot.y, width: hotspot.width, height: hotspot.height });
    }

    function beginHotspotDraw(event, owner) {
      if (!hotspotEditMode.value || event.target !== event.currentTarget || !owner) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const startX = clamp((event.clientX - rect.left) / rect.width * 100, 0, 96);
      const startY = clamp((event.clientY - rect.top) / rect.height * 100, 0, 96);
      const hotspot = addHotspot(owner, { x: startX, y: startY, width: 4, height: 4 });
      const move = moveEvent => {
        const currentX = clamp((moveEvent.clientX - rect.left) / rect.width * 100, 0, 100);
        const currentY = clamp((moveEvent.clientY - rect.top) / rect.height * 100, 0, 100);
        hotspot.x = Math.round(Math.min(startX, currentX) * 10) / 10;
        hotspot.y = Math.round(Math.min(startY, currentY) * 10) / 10;
        hotspot.width = Math.round(Math.max(4, Math.abs(currentX - startX)) * 10) / 10;
        hotspot.height = Math.round(Math.max(4, Math.abs(currentY - startY)) * 10) / 10;
        normalizeHotspotInPlace(hotspot);
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end, { once: true });
    }
    function openMediaPicker(mode = "add") {
      mediaPickerMode.value = mode;
      productMediaSlot.value = null;
      productMediaTarget.value = "gallery";
      mediaPickerOpen.value = true;
      if (!media.value.length) loadMedia();
    }
    function openProductMediaPicker(slot = null, target = "gallery") {
      productMediaSlot.value = slot;
      productMediaTarget.value = target;
      mediaPickerMode.value = "product";
      mediaPickerOpen.value = true;
      if (!media.value.length) loadMedia();
    }
    function openTabBarMediaPicker(index, field) {
      tabBarMediaTarget.index = index;
      tabBarMediaTarget.field = field;
      mediaPickerMode.value = "tabbar";
      mediaPickerOpen.value = true;
      if (!media.value.length) loadMedia();
    }
    function openServiceBotMediaPicker() {
      mediaPickerMode.value = "servicebot";
      mediaPickerOpen.value = true;
      if (!media.value.length) loadMedia();
    }
    function tabBarCropSourceField(field) { return `${field}Source`; }
    function tabBarCropSettingsField(field) { return `${field}Crop`; }
    function tabBarCropFieldLabel(field) {
      if (field === "centerIcon") return "中间主按钮";
      return field === "iconOn" ? "选中图标" : "默认图标";
    }
    function isAnimatedImage(path) { return /\.gif(?:$|\?)/i.test(String(path || "")); }
    function animatedImageSize(item = {}) {
      const bytes = Number(item.size);
      if (Number.isFinite(bytes) && bytes > 0) return bytes;
      const kb = Number(item.sizeKB);
      return Number.isFinite(kb) && kb > 0 ? kb * 1024 : 0;
    }
    function applyAnimatedTabBarIcon(index, field, source, name = "GIF") {
      if (field !== "centerIcon") {
        toast("普通导航图标不支持动态 GIF", "请为默认图标或选中图标选择静态 PNG、JPG 或 WebP", "error");
        return false;
      }
      const item = cfg.value?.tabBar?.items?.[index];
      if (!item) return false;
      item[field] = source;
      item[tabBarCropSourceField(field)] = source;
      item[tabBarCropSettingsField(field)] = normalizeCrop({ zoom: 1, offsetX: 0, offsetY: 0 });
      mediaPickerOpen.value = false;
      tabBarCrop.open = false;
      toast("动态 GIF 已启用", `${name} 将保留动画；动态图片不能进行取景裁切`);
      return true;
    }
    function tabBarCropTitle() {
      const item = cfg.value?.tabBar?.items?.[tabBarCrop.index];
      return `${item?.text || "导航"} · ${tabBarCropFieldLabel(tabBarCrop.field)}`;
    }
    function cropGeometry(size = 512) {
      const imageWidth = Math.max(1, tabBarCrop.imageWidth);
      const imageHeight = Math.max(1, tabBarCrop.imageHeight);
      const scale = Math.max(size / imageWidth, size / imageHeight) * tabBarCrop.zoom;
      const width = imageWidth * scale;
      const height = imageHeight * scale;
      const maxX = Math.max(0, (width - size) / 2);
      const maxY = Math.max(0, (height - size) / 2);
      return {
        width, height, maxX, maxY,
        left: (size - width) / 2 + tabBarCrop.offsetX * maxX,
        top: (size - height) / 2 + tabBarCrop.offsetY * maxY
      };
    }
    function drawTabBarCrop() {
      if (!tabBarCropImage || !tabBarCrop.imageWidth || !tabBarCrop.imageHeight) return;
      const geometry = cropGeometry(512);
      [tabBarCropCanvas.value, tabBarCropPreviewCanvas.value].forEach(canvas => {
        if (!canvas) return;
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext("2d");
        context.clearRect(0, 0, 512, 512);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(tabBarCropImage, geometry.left, geometry.top, geometry.width, geometry.height);
      });
    }
    function loadTabBarCropSource() {
      tabBarCrop.loading = true;
      tabBarCrop.error = "";
      tabBarCropImage = null;
      const image = new Image();
      image.onload = () => {
        tabBarCropImage = image;
        tabBarCrop.imageWidth = image.naturalWidth || image.width;
        tabBarCrop.imageHeight = image.naturalHeight || image.height;
        tabBarCrop.loading = false;
        nextTick(drawTabBarCrop);
      };
      image.onerror = () => {
        tabBarCrop.loading = false;
        tabBarCrop.error = "图片读取失败，请重新选择图片或检查文件是否完整。";
      };
      image.src = mpUrl(tabBarCrop.source);
    }
    function openTabBarCrop(index, field, source = "", crop = null) {
      const item = cfg.value?.tabBar?.items?.[index];
      if (!item) return;
      const storedSource = item[tabBarCropSourceField(field)] || item[field];
      const cropSource = source || (isAnimatedImage(storedSource) && !isAnimatedImage(item[field]) ? item[field] : storedSource);
      if (field === "centerIcon" && isAnimatedImage(cropSource)) {
        toast("当前为动态 GIF", "动画已完整保留；如需调整取景，请先更换为静态图片");
        return;
      }
      const sourceField = tabBarCropSourceField(field);
      const cropField = tabBarCropSettingsField(field);
      const normalized = normalizeCrop(crop || item[cropField]);
      Object.assign(tabBarCrop, {
        open: true, index, field,
        source: cropSource,
        zoom: normalized.zoom, offsetX: normalized.offsetX, offsetY: normalized.offsetY,
        imageWidth: 0, imageHeight: 0, loading: true, applying: false, error: "",
        isGif: isAnimatedImage(cropSource)
      });
      mediaPickerOpen.value = false;
      nextTick(() => {
        loadTabBarCropSource();
        document.querySelector(".crop-viewport")?.focus();
      });
    }
    function closeTabBarCrop() {
      if (tabBarCrop.applying) return;
      tabBarCrop.open = false;
      tabBarCrop.error = "";
      tabBarCropImage = null;
      tabBarCropDrag = null;
    }
    function resetTabBarCrop() {
      tabBarCrop.zoom = 1;
      tabBarCrop.offsetX = 0;
      tabBarCrop.offsetY = 0;
      drawTabBarCrop();
    }
    function updateTabBarCropZoom(value) {
      tabBarCrop.zoom = clamp(value, 1, 3);
      drawTabBarCrop();
    }
    function beginTabBarCropDrag(event) {
      if (tabBarCrop.loading || tabBarCrop.applying || !tabBarCropImage) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      tabBarCropDrag = {
        pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        offsetX: tabBarCrop.offsetX, offsetY: tabBarCrop.offsetY,
        viewportSize: event.currentTarget.clientWidth || 360
      };
    }
    function moveTabBarCropDrag(event) {
      if (!tabBarCropDrag || tabBarCropDrag.pointerId !== event.pointerId) return;
      const geometry = cropGeometry(512);
      const factor = 512 / tabBarCropDrag.viewportSize;
      if (geometry.maxX) tabBarCrop.offsetX = clamp(tabBarCropDrag.offsetX + (event.clientX - tabBarCropDrag.x) * factor / geometry.maxX, -1, 1);
      if (geometry.maxY) tabBarCrop.offsetY = clamp(tabBarCropDrag.offsetY + (event.clientY - tabBarCropDrag.y) * factor / geometry.maxY, -1, 1);
      drawTabBarCrop();
    }
    function endTabBarCropDrag(event) {
      if (!tabBarCropDrag || tabBarCropDrag.pointerId !== event.pointerId) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      tabBarCropDrag = null;
    }
    function handleTabBarCropKey(event) {
      const step = event.shiftKey ? .1 : .025;
      const zoomStep = event.shiftKey ? .2 : .05;
      let handled = true;
      if (event.key === "ArrowLeft") tabBarCrop.offsetX = clamp(tabBarCrop.offsetX - step, -1, 1);
      else if (event.key === "ArrowRight") tabBarCrop.offsetX = clamp(tabBarCrop.offsetX + step, -1, 1);
      else if (event.key === "ArrowUp") tabBarCrop.offsetY = clamp(tabBarCrop.offsetY - step, -1, 1);
      else if (event.key === "ArrowDown") tabBarCrop.offsetY = clamp(tabBarCrop.offsetY + step, -1, 1);
      else if (event.key === "+" || event.key === "=") tabBarCrop.zoom = clamp(tabBarCrop.zoom + zoomStep, 1, 3);
      else if (event.key === "-" || event.key === "_") tabBarCrop.zoom = clamp(tabBarCrop.zoom - zoomStep, 1, 3);
      else handled = false;
      if (!handled) return;
      event.preventDefault();
      drawTabBarCrop();
    }
    async function applyTabBarCrop() {
      if (!tabBarCropImage || tabBarCrop.loading || tabBarCrop.applying) return;
      tabBarCrop.applying = true;
      tabBarCrop.error = "";
      try {
        drawTabBarCrop();
        const isCenterButton = tabBarCrop.field === "centerIcon";
        const data = tabBarCropCanvas.value.toDataURL(isCenterButton ? "image/jpeg" : "image/webp", .92);
        const name = `tab-${tabBarCrop.index + 1}-${tabBarCrop.field}-crop-${Date.now()}.${isCenterButton ? "jpg" : "webp"}`;
        const response = await fetch("/api/media/upload", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, data })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "取景图片保存失败");
        const item = cfg.value?.tabBar?.items?.[tabBarCrop.index];
        if (!item) throw new Error("未找到对应的导航项");
        item[tabBarCrop.field] = result.mpPath;
        item[tabBarCropSourceField(tabBarCrop.field)] = tabBarCrop.source;
        item[tabBarCropSettingsField(tabBarCrop.field)] = normalizeCrop(tabBarCrop);
        const label = tabBarCropTitle();
        tabBarCrop.open = false;
        tabBarCropImage = null;
        await loadMedia();
        toast("图片取景已应用", `${label} · 已生成 512 × 512 WebP`);
      } catch (error) {
        tabBarCrop.error = error.message || "取景图片保存失败，请重试。";
      } finally {
        tabBarCrop.applying = false;
      }
    }
    function openSectionMediaPicker() {
      mediaPickerMode.value = "section-media";
      mediaPickerOpen.value = true;
      if (!media.value.length) loadMedia();
    }
    function applySectionMedia(item) {
      const section = selectedSection.value;
      if (!section || !["media", "appointment-hero"].includes(section.type)) return;
      if (section.type === "appointment-hero") {
        section.props.backgroundSrc = item.mpPath;
        section.props.backgroundFit = section.props.backgroundFit || "cover";
        section.props.backgroundPosition = section.props.backgroundPosition || "center";
        mediaPickerOpen.value = false;
        toast("预约头图已应用", item.name);
        return;
      }
      section.props.mode = item.kind === "video" ? "video" : "image";
      section.props.src = item.mpPath;
      mediaPickerOpen.value = false;
      toast(item.kind === "video" ? "视频背景已应用" : "图片背景已应用", item.name);
    }
    function addProductMedia(item) {
      if (item.kind === "video") { toast("商品主图暂不支持视频", "请先选择图片素材", "error"); return; }
      const product = editingProduct.value;
      if (!product) return;
      if (productMediaTarget.value === "detail") {
        product.detailImages = [...(product.detailImages || []), item.mpPath].filter((path, index, list) => list.indexOf(path) === index).slice(0, 12);
        mediaPickerOpen.value = false;
        toast("详情图已添加", `已使用 ${product.detailImages.length}/12 张`);
        return;
      }
      product.gallery = productImages(product);
      const slot = productMediaSlot.value;
      if (slot === null || slot === undefined) product.gallery.push(item.mpPath);
      else product.gallery[slot] = item.mpPath;
      product.gallery = product.gallery.filter(Boolean).slice(0, 5);
      product.img = product.gallery[0] || item.mpPath;
      mediaPickerOpen.value = false;
      toast(slot === null || slot === undefined ? "商品主图已添加" : "商品主图已替换", `已使用 ${product.gallery.length}/5 张`);
    }
    function applyTabBarMedia(item) {
      if (item.kind === "video") { toast("导航图标仅支持图片", "请选择 PNG、JPG、WebP 或 GIF 图片", "error"); return; }
      const tabItem = cfg.value?.tabBar?.items?.[tabBarMediaTarget.index];
      if (!tabItem) return;
      if (isAnimatedImage(item.mpPath || item.name)) {
        if (animatedImageSize(item) > tabBarGifMaxBytes) {
          toast("GIF 文件过大", "动态导航图标需小于 1.2 MB，才能通过微信预览包限制", "error");
          return;
        }
        applyAnimatedTabBarIcon(tabBarMediaTarget.index, tabBarMediaTarget.field, item.mpPath, item.name);
        return;
      }
      openTabBarCrop(tabBarMediaTarget.index, tabBarMediaTarget.field, item.mpPath, { zoom: 1, offsetX: 0, offsetY: 0 });
    }
    function applyServiceBotMedia(item) {
      if (item.kind === "video") { toast("客服图标仅支持图片", "请选择 PNG、JPG、WebP 或 GIF", "error"); return; }
      cfg.value.serviceBot.icon = item.mpPath;
      mediaPickerOpen.value = false;
      toast("客服图标已更新", item.name);
    }
    function addMediaToHero(item) {
      if (mediaPickerMode.value === "product") { addProductMedia(item); return; }
      if (mediaPickerMode.value === "section-media") { applySectionMedia(item); return; }
      if (mediaPickerMode.value === "tabbar") { applyTabBarMedia(item); return; }
      if (mediaPickerMode.value === "servicebot") { applyServiceBotMedia(item); return; }
      if (!selectedSection.value || selectedSection.value.type !== "hero") return;
      const slide = {
        ...makeSlide(null), kind: item.kind || "image", src: item.mpPath,
        poster: item.kind === "video" ? "" : item.mpPath,
        title: "", subtitle: "", showContent: false, buttonText: "", showButton: false
      };
      if (mediaPickerMode.value === "replace" && selectedHeroSlide.value) {
        Object.assign(selectedHeroSlide.value, { kind: slide.kind, src: slide.src, poster: slide.poster });
      } else {
        selectedSection.value.props.slides.push(slide);
        selectedSlideIndex.value = selectedSection.value.props.slides.length - 1;
      }
      mediaPickerOpen.value = false;
      toast(mediaPickerMode.value === "replace" ? "媒体已替换" : "媒体已添加", item.name);
    }
    function removeHeroSlide(index) {
      const slides = selectedSection.value?.props?.slides;
      if (!slides || slides.length <= 1) { toast("至少保留一张轮播", "可先添加新的图片或视频", "error"); return; }
      const removed = slides.splice(index, 1)[0];
      selectedSlideIndex.value = Math.min(selectedSlideIndex.value, slides.length - 1);
      toast("轮播图片已删除", `${removed?.title || "当前媒体"} · 还剩 ${slides.length} 项`);
    }
    function moveHeroSlide(index, delta) {
      const slides = selectedSection.value?.props?.slides || [];
      const target = index + delta;
      if (target < 0 || target >= slides.length) return;
      const [slide] = slides.splice(index, 1);
      slides.splice(target, 0, slide);
      selectedSlideIndex.value = target;
    }
    function beginSlideDrag(index) { dragSlideIndex = index; }
    function dropSlide(index) {
      if (dragSlideIndex < 0 || dragSlideIndex === index) return;
      const slides = selectedSection.value?.props?.slides || [];
      const [slide] = slides.splice(dragSlideIndex, 1);
      slides.splice(index, 0, slide);
      selectedSlideIndex.value = index;
      dragSlideIndex = -1;
    }

    async function loadMedia() {
      mediaLoading.value = true;
      mediaError.value = "";
      try {
        const [mediaResponse, folderResponse] = await Promise.all([fetch("/api/media"), fetch("/api/media/folders")]);
        if (!mediaResponse.ok) throw new Error(`媒体库加载失败（${mediaResponse.status}）`);
        if (!folderResponse.ok) throw new Error(`媒体文件夹加载失败（${folderResponse.status}）`);
        media.value = (await mediaResponse.json()).map(item => ({
          ...item,
          kind: item.kind || (/\.(mp4|webm|mov)$/i.test(item.name || item.path || "") ? "video" : "image")
        }));
        mediaFolders.value = await folderResponse.json();
        const availableNames = new Set(media.value.map(item => item.name));
        selectedMediaNames.value = selectedMediaNames.value.filter(name => availableNames.has(name));
        if (selectedMedia.value && !availableNames.has(selectedMedia.value.name)) selectedMedia.value = null;
        if (mediaFolderId.value && !mediaFolders.value.some(folder => folder.id === mediaFolderId.value)) mediaFolderId.value = "";
      } catch (error) {
        mediaError.value = error.message;
      } finally {
        mediaLoading.value = false;
      }
    }

    async function uploadFiles(fileList, addToCarousel = false, folderId = mediaFolderId.value) {
      const files = Array.from(fileList || []).filter(file => {
        const extension = String(file.name || "").split(".").pop().toLowerCase();
        return file.type.startsWith("image/") || file.type.startsWith("video/") || mediaExtensions.has(extension);
      });
      if (!files.length) return [];
      const uploaded = [];
      for (const file of files) {
        try {
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          const response = await fetch("/api/media/upload", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, data, folderId: folderId || "" })
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result.ok) throw new Error(result.error || "上传失败");
          uploaded.push(result);
          if (addToCarousel) addMediaToHero(result);
        } catch (error) {
          toast(`上传失败：${file.name}`, error.message, "error");
        }
      }
      await loadMedia();
      toast("上传完成", `已处理 ${files.length} 个文件`);
      return uploaded;
    }

    async function uploadProductImages(fileList, target = "gallery") {
      const remaining = Math.max(0, (target === "detail" ? 12 : 5) - (target === "detail" ? (editingProduct.value?.detailImages || []).length : productImages(editingProduct.value).length));
      const files = Array.from(fileList || []).filter(file => file.type.startsWith("image/")).slice(0, remaining);
      if (!files.length) { toast(target === "detail" ? "最多保留 12 张详情图" : "最多保留 5 张主图", "请先删除现有图片，或选择图片文件。", "error"); return; }
      const uploaded = await uploadFiles(files, false);
      if (target === "detail") {
        editingProduct.value.detailImages = [...(editingProduct.value.detailImages || []), ...uploaded.filter(item => item.kind !== "video").map(item => item.mpPath)].filter((path, index, list) => list.indexOf(path) === index).slice(0, 12);
        return;
      }
      uploaded.filter(item => item.kind !== "video").forEach(item => {
        editingProduct.value.gallery = productImages(editingProduct.value);
        editingProduct.value.gallery.push(item.mpPath);
        editingProduct.value.gallery = editingProduct.value.gallery.slice(0, 5);
      });
      editingProduct.value.img = editingProduct.value.gallery[0] || editingProduct.value.img;
    }

    async function uploadTabBarIcon(fileList, index, field) {
      const file = Array.from(fileList || []).find(item => item.type.startsWith("image/"));
      if (!file) { toast("请选择图片文件", "导航图标支持 PNG、JPG、WebP 或 GIF", "error"); return; }
      if (isAnimatedImage(file.name) && file.size > tabBarGifMaxBytes) {
        toast("GIF 文件过大", "动态导航图标需小于 1.2 MB，才能通过微信预览包限制", "error");
        return;
      }
      if (isAnimatedImage(file.name) && field !== "centerIcon") {
        toast("普通导航图标不支持动态 GIF", "GIF 只能用于中间主按钮，请选择 PNG、JPG 或 WebP", "error");
        return;
      }
      const uploaded = await uploadFiles([file], false);
      const image = uploaded.find(item => item.kind !== "video");
      if (!image) return;
      const tabItem = cfg.value?.tabBar?.items?.[index];
      if (!tabItem) return;
      if (isAnimatedImage(image.mpPath || image.name)) {
        if (animatedImageSize(image) > tabBarGifMaxBytes) {
          toast("GIF 文件过大", "动态导航图标需小于 1.2 MB，才能通过微信预览包限制", "error");
          return;
        }
        applyAnimatedTabBarIcon(index, field, image.mpPath, image.name);
        return;
      }
      openTabBarCrop(index, field, image.mpPath, { zoom: 1, offsetX: 0, offsetY: 0 });
    }

    async function uploadServiceBotIcon(fileList) {
      const file = Array.from(fileList || []).find(item => item.type.startsWith("image/"));
      if (!file) { toast("请选择图片文件", "客服图标支持 PNG、JPG、WebP 或 GIF", "error"); return; }
      const uploaded = await uploadFiles([file], false);
      const image = uploaded.find(item => item.kind !== "video");
      if (image) applyServiceBotMedia(image);
    }

    async function uploadSectionMedia(fileList) {
      const file = Array.from(fileList || []).find(item => {
        const extension = String(item.name || "").split(".").pop().toLowerCase();
        return item.type.startsWith("image/") || item.type.startsWith("video/") || mediaExtensions.has(extension);
      });
      if (!file) return;
      const uploaded = await uploadFiles([file], false);
      if (uploaded[0]) applySectionMedia(uploaded[0]);
    }

    async function uploadFontFiles(fileList) {
      const file = Array.from(fileList || [])[0];
      if (!file) return;
      fontUploading.value = true;
      try {
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        const response = await fetch("/api/fonts/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, data }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "字体上传失败");
        const id = `custom-${Date.now().toString(36)}`;
        cfg.value.customFonts.push({ id, name: file.name.replace(/\.[^.]+$/, ""), url: result.mpPath, sizeKB: result.sizeKB, format: file.name.split(".").pop().toLowerCase() });
        installCustomFonts(cfg.value.customFonts);
        if (selectedSection.value) selectedSection.value.style.fontFamily = id;
        toast("自定义字体已添加", `${result.sizeKB} KB · 请确认拥有字体使用授权`);
      } catch (error) { toast("字体上传失败", error.message, "error"); }
      finally { fontUploading.value = false; }
    }

    async function loadSystemFonts() {
      systemFontsLoading.value = true;
      try {
        const response = await fetch("/api/system-fonts");
        if (!response.ok) throw new Error(`系统字体读取失败（${response.status}）`);
        systemFonts.value = await response.json();
      } catch (error) { toast("电脑字体读取失败", error.message, "error"); }
      finally { systemFontsLoading.value = false; }
    }

    async function importSelectedSystemFont() {
      const section = selectedSection.value;
      const fontId = section?.style?.fontFamily || "";
      if (!fontId.startsWith("system:")) return;
      const name = fontId.slice(7);
      const font = systemFonts.value.find(item => item.name === name);
      if (!font) return;
      fontUploading.value = true;
      try {
        const response = await fetch("/api/fonts/import-system", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(font)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "字体导入失败");
        const id = `local-${Date.now().toString(36)}`;
        cfg.value.customFonts.push({ id, name, url: result.mpPath, sizeKB: result.sizeKB, format: result.format });
        installCustomFonts(cfg.value.customFonts);
        section.style.fontFamily = id;
        toast("字体已打包", `${name} · ${result.sizeKB} KB，请确认拥有小程序使用授权`);
      } catch (error) { toast("电脑字体导入失败", error.message, "error"); }
      finally { fontUploading.value = false; }
    }

    function addCustomFontUrl() {
      const url = window.prompt("请输入可公开访问的 WOFF2/WOFF/TTF 字体地址");
      if (!url) return;
      const name = window.prompt("字体显示名称", "自定义品牌字体") || "自定义品牌字体";
      const id = `custom-${Date.now().toString(36)}`;
      cfg.value.customFonts.push({ id, name, url, format: url.split(".").pop().split("?")[0] || "woff2" });
      installCustomFonts(cfg.value.customFonts);
      if (selectedSection.value) selectedSection.value.style.fontFamily = id;
    }

    async function createMediaFolder() {
      const name = window.prompt("文件夹名称", "新品素材");
      if (!name?.trim()) return;
      try {
        const response = await fetch("/api/media/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "新建文件夹失败");
        mediaFolders.value = [...mediaFolders.value, result.folder];
        mediaFolderId.value = result.folder.id;
        toast("文件夹已创建", result.folder.name);
      } catch (error) {
        toast("新建文件夹失败", error.message, "error");
      }
    }

    async function renameMediaFolder(folder) {
      if (!folder) return;
      const name = window.prompt("文件夹名称", folder.name);
      if (!name?.trim() || name.trim() === folder.name) return;
      try {
        const response = await fetch(`/api/media/folders/${encodeURIComponent(folder.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "重命名失败");
        folder.name = result.folder.name;
        media.value.forEach(item => { if (item.folderId === folder.id) item.folderName = folder.name; });
        toast("文件夹已重命名", folder.name);
      } catch (error) {
        toast("文件夹重命名失败", error.message, "error");
      }
    }

    async function deleteMediaFolder(folder) {
      if (!folder) return;
      if (!window.confirm(`确定删除文件夹“${folder.name}”吗？文件夹内必须没有素材。`)) return;
      try {
        const response = await fetch(`/api/media/folders/${encodeURIComponent(folder.id)}`, { method: "DELETE" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "删除文件夹失败");
        mediaFolders.value = mediaFolders.value.filter(item => item.id !== folder.id);
        mediaFolderId.value = "";
        toast("文件夹已删除", folder.name);
      } catch (error) {
        toast("删除文件夹失败", error.message, "error");
      }
    }

    async function moveSelectedMedia(folderId = mediaMoveTarget.value) {
      const names = [...selectedMediaNames.value];
      if (!names.length) return;
      try {
        const response = await fetch("/api/media/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names, folderId: folderId || "" }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "移动素材失败");
        selectedMediaNames.value = [];
        mediaMoveTarget.value = "";
        await loadMedia();
        toast("素材已移动", folderId ? mediaFolders.value.find(folder => folder.id === folderId)?.name || "目标文件夹" : "全部素材");
      } catch (error) {
        toast("移动素材失败", error.message, "error");
      }
    }

    function isMediaSelected(item) {
      return selectedMediaNames.value.includes(item?.name);
    }

    function selectMedia(item) {
      if (mediaSelectionMode.value) {
        const selected = new Set(selectedMediaNames.value);
        if (selected.has(item.name)) selected.delete(item.name);
        else selected.add(item.name);
        selectedMediaNames.value = [...selected];
        return;
      }
      selectedMedia.value = selectedMedia.value?.name === item.name ? null : item;
    }

    function toggleMediaSelectionMode() {
      mediaSelectionMode.value = !mediaSelectionMode.value;
      selectedMediaNames.value = mediaSelectionMode.value && selectedMedia.value ? [selectedMedia.value.name] : [];
      selectedMedia.value = null;
    }

    function toggleAllFilteredMedia() {
      const selected = new Set(selectedMediaNames.value);
      if (allFilteredMediaSelected.value) filteredMedia.value.forEach(item => selected.delete(item.name));
      else filteredMedia.value.forEach(item => selected.add(item.name));
      selectedMediaNames.value = [...selected];
    }

    function mediaReferenceCount(mpPath) {
      let count = 0;
      const visit = value => {
        if (value === mpPath) { count += 1; return; }
        if (Array.isArray(value)) { value.forEach(visit); return; }
        if (value && typeof value === "object") Object.values(value).forEach(visit);
      };
      visit(cfg.value);
      return count;
    }

    async function deleteMediaItems(items) {
      const targets = [...new Map((items || []).filter(Boolean).map(item => [item.name, item])).values()];
      if (!targets.length || mediaDeleting.value) return;
      const referenceCount = targets.reduce((total, item) => total + mediaReferenceCount(item.mpPath), 0);
      const usageWarning = referenceCount
        ? `\n\n检测到这些素材在当前配置中共有 ${referenceCount} 处引用，删除后对应页面可能出现空图。`
        : "";
      if (!window.confirm(`确定永久删除 ${targets.length} 个素材吗？此操作无法撤销。${usageWarning}`)) return;
      mediaDeleting.value = true;
      try {
        const response = await fetch("/api/media/delete", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names: targets.map(item => item.name) })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || "素材删除失败");
        await loadMedia();
        toast("素材已删除", `已删除 ${result.deleted.length} 个文件${result.missing.length ? `，${result.missing.length} 个文件不存在` : ""}`);
      } catch (error) {
        toast("素材删除失败", error.message || "请稍后重试", "error");
      } finally {
        mediaDeleting.value = false;
      }
    }

    function deleteMediaItem(item) {
      return deleteMediaItems([item]);
    }

    function deleteSelectedMedia() {
      const selected = new Set(selectedMediaNames.value);
      return deleteMediaItems(media.value.filter(item => selected.has(item.name)));
    }

    function editProduct(product) { editingProduct.value = JSON.parse(JSON.stringify(normalizeProduct(product))); }
    function addProduct() {
      const nextId = Math.max(0, ...cfg.value.products.map(p => Number(p.id) || 0)) + 1;
      editingProduct.value = normalizeProduct({ id: nextId, cat: cfg.value.categories[0]?.id || "new", name: "新商品", price: 0, img: "" });
    }
    function saveProduct() {
      const product = normalizeProduct(editingProduct.value);
      if (!product.name.trim()) { toast("请输入商品名称", "商品名称不能为空", "error"); return; }
      if (!product.gallery.length) { toast("请上传商品主图", "至少需要一张图片作为商品封面。", "error"); return; }
      const index = cfg.value.products.findIndex(p => p.id === product.id);
      if (index >= 0) cfg.value.products[index] = JSON.parse(JSON.stringify(product));
      else cfg.value.products.unshift(JSON.parse(JSON.stringify(product)));
      editingProduct.value = null;
      toast("商品已更新", "保存或同步后写入项目");
    }
    function removeProductImage(index) {
      const product = editingProduct.value;
      const images = productImages(product);
      if (images.length <= 1) { toast("至少保留一张主图", "商品需要一张封面图。", "error"); return; }
      images.splice(index, 1);
      product.gallery = images;
      product.img = images[0];
      toast("主图已移除", `还剩 ${images.length}/5 张`);
    }
    function removeProductDetailImage(index) {
      if (!editingProduct.value?.detailImages) return;
      editingProduct.value.detailImages.splice(index, 1);
    }
    function addProductColor() {
      if (!editingProduct.value) return;
      editingProduct.value.colors ||= [];
      editingProduct.value.colors.push({ name: "新颜色", value: "#1f1d1a" });
    }
    function removeProductColor(index) { editingProduct.value?.colors?.splice(index, 1); }
    function addProductSize() {
      if (!editingProduct.value) return;
      editingProduct.value.sizes ||= [];
      editingProduct.value.sizes.push("新尺码");
    }
    function removeProductSize(index) { editingProduct.value?.sizes?.splice(index, 1); }
    function removeProduct(product) {
      if (!window.confirm(`确定删除“${product.name}”吗？`)) return;
      const index = cfg.value.products.findIndex(p => p.id === product.id);
      if (index >= 0) cfg.value.products.splice(index, 1);
      toast("商品已删除", "可使用撤销恢复");
    }

    function removeCategory(category) {
      const productCount = cfg.value.products.filter(product => product.cat === category.id).length;
      const sectionCount = Object.values(cfg.value.pageLayouts || {}).flat().filter(section => section.type === "product-grid" && section.props?.category === category.id).length;
      if (productCount || sectionCount) {
        const reasons = [];
        if (productCount) reasons.push(`${productCount} 个商品`);
        if (sectionCount) reasons.push(`${sectionCount} 个页面商品区块`);
        toast("无法删除分类", `“${category.name}”仍被 ${reasons.join("和")} 使用，请先处理关联内容。`, "error");
        return;
      }
      if (cfg.value.categories.length <= 1) {
        toast("至少保留一个分类", "请先新建其他分类，再删除当前分类。", "error");
        return;
      }
      if (!window.confirm(`确定删除“${category.name}”吗？`)) return;
      const index = cfg.value.categories.findIndex(item => item.id === category.id);
      if (index < 0) return;
      cfg.value.categories.splice(index, 1);
      if (productCategory.value === category.id) productCategory.value = "all";
      toast("分类已删除", `“${category.name}”已移除。`);
    }

    function applyPreset(key, preset) {
      cfg.value.theme.preset = key;
      cfg.value.theme.colors = JSON.parse(JSON.stringify(preset.colors));
      toast("主题已应用", preset.name);
    }

    function statusText() {
      if (saveMode.value === "saving") return "正在保存…";
      if (saveMode.value === "syncing") return "正在同步…";
      if (saveMode.value === "error") return "操作失败";
      if (isDirty.value) return "有未保存更改";
      if (cfg.value?._lastSync) return `已保存 · ${new Date(cfg.value._lastSync).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 已同步`;
      return "所有更改已保存";
    }

    window.addEventListener("keydown", event => {
      if (tabBarCrop.open && event.key === "Escape") {
        event.preventDefault();
        closeTabBarCrop();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); saveConfig();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault(); event.shiftKey ? redo() : undo();
      }
    });

    loadCart();
    loadConfig();

    return {
      cfg, loading, loadError, currentView, currentPage, currentPageMeta, pageDefinitions, selectedId, inspectorTab, device, zoom, saveMode, leftPanelOpen, rightPanelOpen,
      media, mediaFolders, mediaFolderId, mediaMoveTarget, mediaLoading, mediaError, mediaQuery, selectedMedia, mediaSelectionMode, selectedMediaNames, mediaDeleting, selectedMediaCount, allFilteredMediaSelected, selectedSlideIndex, selectedHeroSlide, mediaPickerItems, mediaKindLabel, centerTabStyle, serviceBotStyle, serviceBotDrag,
      hotspotEditMode, selectedHotspotId, hotspotOwner, currentHotspots, selectedHotspot,
      mediaPickerOpen, mediaPickerMode, productMediaTarget, tabBarMediaTarget, tabBarCrop, tabBarCropCanvas, tabBarCropPreviewCanvas, fontUploading, systemFonts, systemFontsLoading, fontPresets, fontOptions, hasStyleOverrides, productQuery, productCategory,
      editingProduct, newPage, homeNavOpen, blockQuickAddOpen, previewDialog, servicePreview, toasts, navItems, blockLibrary, viewTitle, sections, selectedSection, isDirty,
      canUndo, canRedo, filteredProducts, filteredMedia, saveConfig, syncProject, openPhonePreview, closePhonePreview, switchView, togglePanel, undo, redo,
      statusText, blockLabel, addBlock, moveSection, duplicateSection, deleteSection, toggleSection, openNewPage, createBlankPage, openHomeNavigation, addHomeChannel, moveHomeChannel, removeHomeChannel, finishHomeNavigation, switchPage, navigatePreview,
      previewHero, sectionProducts, detailProduct, cartLines, cartSummary, addToCart, changeCartQuantity, mpUrl, money, categoryName, sectionStyle, loadMedia, uploadFiles, uploadFontFiles, loadSystemFonts, importSelectedSystemFont, serviceBotClick, closeServicePreview, previewServicePrompt, openPreviewAppointment, submitPreviewAppointment, beginServiceBotDrag, moveServiceBotDrag, endServiceBotDrag,
      selectMedia, isMediaSelected, toggleMediaSelectionMode, toggleAllFilteredMedia, deleteMediaItem, deleteSelectedMedia, createMediaFolder, renameMediaFolder, deleteMediaFolder, moveSelectedMedia, isAnimatedImage, editProduct, addProduct, saveProduct, removeProduct, removeCategory, productImages, openProductMediaPicker, uploadProductImages, removeProductImage, removeProductDetailImage, addProductColor, removeProductColor, addProductSize, removeProductSize, openSectionMediaPicker, uploadSectionMedia, openTabBarMediaPicker, uploadTabBarIcon, openServiceBotMediaPicker, uploadServiceBotIcon, openTabBarCrop, closeTabBarCrop, resetTabBarCrop, updateTabBarCropZoom, beginTabBarCropDrag, moveTabBarCropDrag, endTabBarCropDrag, handleTabBarCropKey, applyTabBarCrop, tabBarCropTitle, applyPreset, resetSectionStyle,
      selectHeroSlide, updateHeroLinkType, openMediaPicker, addMediaToHero, removeHeroSlide, moveHeroSlide, beginSlideDrag, dropSlide, addCustomFontUrl,
      hotspotStyle, addHotspot, removeHotspot, updateHotspotLinkType, normalizeHotspotInPlace, beginHotspotPointer, beginHotspotDraw
    };
  },

  template: `
    <div class="app-shell" :class="{'editor-mode': currentView === 'editor'}">
      <header class="topbar">
        <div class="brand-lockup">
          <img class="brand-logo" src="/mp-images/privlan-ai-logo.png" alt="PRIVLAN">
          <div class="brand-edition">COMMERCE STUDIO</div>
        </div>
        <div class="top-context">
          <span class="crumb">小程序</span><iconify-icon class="icon crumb" icon="ph:caret-right"></iconify-icon>
          <span class="crumb crumb-current">{{ viewTitle }}</span>
          <span class="action-divider"></span>
          <span class="save-state" :class="{ dirty: isDirty, error: saveMode === 'error' }"><i class="save-dot"></i>{{ statusText() }}</span>
        </div>
        <div class="top-actions">
          <button class="icon-btn" title="撤销 Ctrl+Z" :disabled="!canUndo" @click="undo"><iconify-icon class="icon" icon="ph:arrow-u-up-left"></iconify-icon></button>
          <button class="icon-btn" title="重做 Ctrl+Shift+Z" :disabled="!canRedo" @click="redo"><iconify-icon class="icon" icon="ph:arrow-u-up-right"></iconify-icon></button>
          <span class="action-divider"></span>
          <button class="btn" :disabled="saveMode === 'saving' || !isDirty" @click="saveConfig(false)"><iconify-icon class="icon" icon="ph:floppy-disk"></iconify-icon><span class="btn-label optional">保存</span></button>
          <button class="btn" title="手机扫码预览" :disabled="saveMode === 'syncing' || previewDialog.state === 'syncing' || previewDialog.state === 'generating'" @click="openPhonePreview"><iconify-icon class="icon" icon="ph:device-mobile-camera"></iconify-icon><span class="btn-label">手机扫码预览</span></button>
          <button class="btn primary" :disabled="saveMode === 'syncing'" @click="syncProject"><iconify-icon class="icon" icon="ph:arrows-clockwise"></iconify-icon><span class="btn-label">同步小程序</span></button>
        </div>
      </header>

      <div class="workspace">
        <aside class="nav-rail">
          <nav class="nav-main" aria-label="主导航">
            <button v-for="item in navItems" :key="item.id" class="nav-item" :class="{active: currentView === item.id}" @click="switchView(item.id)">
              <iconify-icon class="icon" :icon="item.icon"></iconify-icon><span>{{ item.label }}</span>
            </button>
          </nav>
          <div class="nav-spacer"></div>
          <button class="nav-item" title="帮助"><iconify-icon class="icon" icon="ph:question"></iconify-icon><span>帮助</span></button>
        </aside>

        <main class="workspace-main">
          <div v-if="loading" class="empty-state"><iconify-icon class="icon" icon="ph:circle-notch"></iconify-icon><div>正在载入编辑器…</div></div>
          <div v-else-if="loadError" class="empty-state">
            <iconify-icon class="icon" icon="ph:warning-circle"></iconify-icon><h3>无法载入配置</h3><p>{{ loadError }}</p>
            <button class="btn" @click="location.reload()">重新加载</button>
          </div>

          <div v-else-if="currentView === 'editor'" class="editor-layout" :class="{'left-closed':!leftPanelOpen,'right-closed':!rightPanelOpen}">
            <aside class="side-panel left-panel" :class="{open:leftPanelOpen}">
              <div class="panel-header"><div><div class="panel-title">页面区块</div><div class="panel-subtitle">点击添加到当前页面</div></div><button class="icon-btn panel-close" title="收起页面区块" @click="togglePanel('left')"><iconify-icon class="icon" icon="ph:sidebar-simple"></iconify-icon></button></div>
              <div class="panel-scroll">
                <div class="section-label"><span>页面</span><span>{{ pageDefinitions.length }} 个</span></div>
                <div class="page-navigator">
                  <button v-for="page in pageDefinitions" :key="page.id" :class="{active:currentPage===page.id}" @click="switchPage(page.id)"><iconify-icon class="icon" :icon="page.icon"></iconify-icon><span>{{ page.name }}</span></button>
                  <button v-if="currentPage==='home'" class="page-create page-nav-settings" @click="openHomeNavigation"><iconify-icon class="icon" icon="ph:rows"></iconify-icon><span>首页导航 · {{ cfg.homeChannels.length }} 项</span></button>
                  <button class="page-create" @click="openNewPage"><iconify-icon class="icon" icon="ph:plus-circle"></iconify-icon><span>新建空白页</span></button>
                </div>
                <div class="section-label block-library-label"><span>基础区块</span><button class="section-add-btn" type="button" title="添加区块" :aria-expanded="blockQuickAddOpen" @click="blockQuickAddOpen = !blockQuickAddOpen"><iconify-icon class="icon" icon="ph:plus"></iconify-icon></button></div>
                <div v-if="blockQuickAddOpen" class="quick-add-menu" role="menu">
                  <button v-for="block in blockLibrary" :key="'quick-' + block.type" type="button" role="menuitem" class="quick-add-item" @click="addBlock(block.type)">
                    <iconify-icon class="icon" :icon="block.icon"></iconify-icon><span>{{ block.name }}</span>
                  </button>
                </div>
                <div class="block-grid">
                  <button v-for="block in blockLibrary" :key="block.type" class="block-card" @click="addBlock(block.type)">
                    <iconify-icon class="icon" :icon="block.icon"></iconify-icon>
                    <div><div class="block-name">{{ block.name }}</div><div class="block-help">{{ block.help }}</div></div>
                  </button>
                </div>
                <div class="section-label"><span>页面层级</span><span>{{ sections.length }} 个区块</span></div>
                <div class="layer-list">
                  <div v-for="section in sections" :key="section.id" class="layer-item" :class="{active: selectedId === section.id, 'layer-hidden': !section.enabled}" @click="selectedId = section.id">
                    <iconify-icon class="icon layer-drag" icon="ph:dots-six-vertical"></iconify-icon>
                    <span class="layer-name">{{ blockLabel(section) }}</span>
                    <button class="layer-visibility" :title="section.enabled ? '隐藏' : '显示'" @click.stop="toggleSection(section)"><iconify-icon class="icon" :icon="section.enabled ? 'ph:eye' : 'ph:eye-slash'"></iconify-icon></button>
                  </div>
                </div>
              </div>
            </aside>

            <section class="canvas-wrap">
              <div class="canvas-toolbar">
                <div class="canvas-meta"><button class="icon-btn canvas-panel-toggle" title="页面与区块" @click="togglePanel('left')"><iconify-icon class="icon" icon="ph:sidebar-simple"></iconify-icon></button><iconify-icon class="icon" :icon="currentPageMeta.icon"></iconify-icon><select :value="currentPage" @change="switchPage($event.target.value)"><option v-for="page in pageDefinitions" :key="page.id" :value="page.id">{{ page.name }}</option></select><span>·</span><span>{{ sections.length }} 个区块</span></div>
                <div class="canvas-tools"><span>{{ device === 'mobile' ? '390 × 自适应' : device === 'tablet' ? '640 × 自适应' : '桌面预览' }}</span><button class="icon-btn canvas-panel-toggle" title="属性面板" @click="togglePanel('right')"><iconify-icon class="icon" icon="ph:sliders-horizontal"></iconify-icon></button></div>
              </div>
              <div class="canvas-stage">
                <div class="phone-canvas" :class="device" :style="{ transform: 'scale(' + zoom / 100 + ')' }">
                  <div class="mobile-page" :class="{'appointment-preview': currentPage === 'appointment'}" :style="{'--page-bg': cfg.theme.colors.bgPrimary, '--page-secondary': cfg.theme.colors.bgSecondary, '--page-text': cfg.theme.colors.textPrimary, '--page-muted': cfg.theme.colors.textSecondary, '--page-accent': cfg.theme.colors.accent, '--page-border': cfg.theme.colors.border}">
                    <div class="mobile-status"><span>9:41</span><span class="mobile-status-icons"><iconify-icon class="icon" icon="ph:cell-signal-high"></iconify-icon><iconify-icon class="icon" icon="ph:wifi-high"></iconify-icon><iconify-icon class="icon" icon="ph:battery-high"></iconify-icon></span></div>
                    <div v-if="currentPage==='home' || !currentPageMeta.tab" class="mobile-nav"><iconify-icon class="icon" :icon="currentPage==='home' ? 'ph:magnifying-glass' : 'ph:arrow-left'" @click.stop="currentPage!=='home' ? switchPage('home') : null"></iconify-icon><div v-if="currentPage==='home'" class="mobile-channel"><span v-for="(channel,index) in cfg.homeChannels" :key="channel+index" :class="{active:index===0}">{{ channel }}</span></div><div v-else-if="currentPage!=='appointment'" class="mobile-page-title">{{ currentPageMeta.name }}</div></div>

                    <section v-if="currentPage==='cart'" class="cart-preview" aria-label="购物车内容">
                      <div v-if="!cartLines.length" class="cart-empty"><iconify-icon class="icon" icon="ph:shopping-bag"></iconify-icon><h2>购物车还是空的</h2><p>从商品详情加入商品后，会显示在这里。</p><button type="button" @click.stop="switchPage('category')">去选购</button></div>
                      <template v-else><div class="cart-preview-head"><span>已选 {{ cartSummary.quantity }} 件</span><span>{{ money(cartSummary.price) }}</span></div><article v-for="line in cartLines" :key="line.id" class="cart-line"><img :src="mpUrl(line.img)" :alt="line.name"><div class="cart-line-copy"><h3>{{ line.name }}</h3><p>{{ money(line.price) }}</p><div class="cart-quantity"><button type="button" :aria-label="'减少 ' + line.name + ' 数量'" @click.stop="changeCartQuantity(line.id,-1)"><iconify-icon class="icon" icon="ph:minus"></iconify-icon></button><span>{{ line.quantity }}</span><button type="button" :aria-label="'增加 ' + line.name + ' 数量'" @click.stop="changeCartQuantity(line.id,1)"><iconify-icon class="icon" icon="ph:plus"></iconify-icon></button></div></div><strong>{{ money(line.total) }}</strong></article><div class="cart-total"><span>合计</span><strong>{{ money(cartSummary.price) }}</strong></div></template>
                    </section>

                    <div v-if="!sections.length" class="empty-canvas"><div><iconify-icon class="icon" icon="ph:layout"></iconify-icon><h3>从一个区块开始</h3><p>从左侧添加轮播、商品或文字区块。</p></div></div>
                    <template v-for="(section, index) in sections" :key="section.id">
                      <div class="insert-zone"><button title="在此处添加商品区块" @click="addBlock('product-grid', index - 1)"><iconify-icon class="icon" icon="ph:plus"></iconify-icon></button></div>
                      <section class="page-section" :class="{'is-selected': selectedId === section.id, 'is-hidden': !section.enabled}" :data-label="blockLabel(section)" :style="sectionStyle(section)" @click.stop="selectedId = section.id">
                        <div v-if="selectedId === section.id" class="block-float-actions">
                          <button title="上移" @click.stop="moveSection(section.id, -1)"><iconify-icon class="icon" icon="ph:arrow-up"></iconify-icon></button>
                          <button title="下移" @click.stop="moveSection(section.id, 1)"><iconify-icon class="icon" icon="ph:arrow-down"></iconify-icon></button>
                          <button title="复制" @click.stop="duplicateSection(section.id)"><iconify-icon class="icon" icon="ph:copy"></iconify-icon></button>
                          <button title="删除" @click.stop="deleteSection(section.id)"><iconify-icon class="icon" icon="ph:trash"></iconify-icon></button>
                        </div>

                        <div v-if="section.type === 'hero'" class="hero-section" :style="{height: (section.style.height || 460) + 'px'}">
                          <video v-if="previewHero(section).kind === 'video'" :src="mpUrl(previewHero(section).src)" :poster="mpUrl(previewHero(section).poster)" autoplay muted loop playsinline></video>
                          <img v-else :src="mpUrl(previewHero(section).src)" :alt="previewHero(section).title">
                          <div class="hero-overlay"></div>
                          <div class="hotspot-surface" :class="{editing:hotspotEditMode && selectedId===section.id}" @pointerdown="beginHotspotDraw($event, previewHero(section))">
                            <button v-for="(hotspot,hotspotIndex) in previewHero(section).hotspots" :key="hotspot.id" type="button" class="hotspot-marker" :class="{selected:selectedHotspotId===hotspot.id}" :style="hotspotStyle(hotspot)" :aria-label="hotspot.label" @pointerdown.stop="beginHotspotPointer($event,hotspot,'move')" @click.stop="hotspotEditMode ? selectedHotspotId=hotspot.id : navigatePreview(hotspot)"><span>{{ hotspotIndex + 1 }}</span><i v-if="hotspotEditMode && selectedHotspotId===hotspot.id" class="hotspot-resize" @pointerdown.stop="beginHotspotPointer($event,hotspot,'resize')"></i></button>
                          </div>
                          <div v-if="previewHero(section).showContent !== false || previewHero(section).showButton" class="hero-copy"><template v-if="previewHero(section).showContent !== false"><div class="hero-eyebrow">PRIVLAN COLLECTION</div><div class="hero-title">{{ previewHero(section).title }}</div><div class="hero-sub">{{ previewHero(section).subtitle }}</div></template><button v-if="previewHero(section).showButton" class="hero-cta" @click.stop="navigatePreview(previewHero(section))">{{ previewHero(section).buttonText || '探索更多' }}</button></div>
                          <div v-if="section.props.slides?.length > 1" class="hero-dots"><button v-for="(slide, slideIndex) in section.props.slides" :key="slide.id" :class="{active:selectedSlideIndex === slideIndex}" @click.stop="selectHeroSlide(slideIndex)"></button></div>
                        </div>
                        <div v-else-if="section.type === 'media'" class="media-background" :style="{height:(section.style.height || 360) + 'px',backgroundColor:section.props.mode==='color' ? (section.style.backgroundColor || '#ffffff') : '#161616'}" @click.stop="section.props.linkValue && navigatePreview(section.props)"><video v-if="section.props.mode==='video' && section.props.src" :src="mpUrl(section.props.src)" :style="{objectFit:section.props.fit,objectPosition:section.props.position}" :autoplay="section.props.autoplay" :loop="section.props.loop" :muted="section.props.muted" :controls="section.props.controls" playsinline></video><img v-else-if="section.props.mode==='image' && section.props.src" :src="mpUrl(section.props.src)" alt="" :style="{objectFit:section.props.fit,objectPosition:section.props.position}"><div v-if="section.props.mode!=='color' && section.style.overlay" class="media-overlay" :style="{opacity:Number(section.style.overlay || 0)/100}"></div><div class="hotspot-surface" :class="{editing:hotspotEditMode && selectedId===section.id}" @pointerdown="beginHotspotDraw($event, section.props)"><button v-for="(hotspot,hotspotIndex) in section.props.hotspots" :key="hotspot.id" type="button" class="hotspot-marker" :class="{selected:selectedHotspotId===hotspot.id}" :style="hotspotStyle(hotspot)" :aria-label="hotspot.label" @pointerdown.stop="beginHotspotPointer($event,hotspot,'move')" @click.stop="hotspotEditMode ? selectedHotspotId=hotspot.id : navigatePreview(hotspot)"><span>{{ hotspotIndex + 1 }}</span><i v-if="hotspotEditMode && selectedHotspotId===hotspot.id" class="hotspot-resize" @pointerdown.stop="beginHotspotPointer($event,hotspot,'resize')"></i></button></div></div>
                        <div v-else-if="section.type === 'categories'" class="category-section"><button v-for="cat in cfg.categories.slice(0, section.props.count || 5)" :key="cat.id" class="category-pill" @click.stop="switchPage('category')">{{ cat.name }}</button></div>
                        <div v-else-if="section.type === 'product-grid'" class="product-section">
                          <div class="section-heading"><h3 class="serif">{{ section.props.title || '精选商品' }}</h3><button @click.stop="switchPage('category')">查看全部</button></div>
                          <div class="product-preview-grid" :style="{'--columns': section.props.columns || 3, '--gap': (section.style.gap || 10) + 'px'}">
                            <article v-for="product in sectionProducts(section)" :key="product.id" class="product-card" @click.stop="navigatePreview({linkType:'product',linkValue:'/pages/detail/detail?id='+product.id})"><div class="product-image"><img :src="mpUrl(product.img)" :alt="product.name"></div><div v-if="section.props.showName" class="product-name">{{ product.name }}</div><div v-if="section.props.showPrice" class="product-price">{{ money(product.price) }}</div></article>
                          </div>
                        </div>
                        <div v-else-if="section.type === 'member-banner'" class="member-section"><img v-if="section.props.useBrandLogo !== false" class="member-brand-logo" src="/mp-images/privlan-ai-logo-white.png" alt="PRIVLAN"><h3 v-else>{{ section.props.title || cfg.brand.name }}</h3><p>{{ section.props.subtitle || cfg.brand.slogan }}</p><div class="benefits"><button v-for="benefit in cfg.memberBenefits.slice(0,4)" :key="benefit.text" type="button" class="benefit" @click.stop="navigatePreview(benefit)"><img :src="mpUrl(benefit.icon)" :alt="benefit.text"><span>{{ benefit.text }}</span></button></div></div>
                        <div v-else-if="section.type === 'product-detail'" class="detail-section"><div class="detail-gallery"><div class="detail-image"><img :src="mpUrl(productImages(detailProduct(section))[0])" :alt="detailProduct(section).name"></div><div v-if="productImages(detailProduct(section)).length > 1" class="detail-thumbs"><button v-for="(image,index) in productImages(detailProduct(section))" :key="image" :class="{active:index===0}" @click.stop><img :src="mpUrl(image)" :alt="detailProduct(section).name + ' 主图 ' + (index + 1)"></button></div></div><div class="detail-info"><div class="detail-kicker">PRIVLAN COLLECTION</div><h2>{{ detailProduct(section).name }}</h2><div v-if="section.props.showPrice" class="detail-price">{{ money(detailProduct(section).price) }}</div><p>{{ detailProduct(section).description || '精选材质与精确剪裁，呈现舒适、克制而持久的高级质感。' }}</p><div v-if="detailProduct(section).colors?.length" class="detail-options"><span>颜色</span><button v-for="color in detailProduct(section).colors" :key="color.name" class="detail-color"><i :style="{backgroundColor:color.value}"></i>{{ color.name }}</button></div><div v-if="detailProduct(section).sizes?.length" class="detail-options"><span>尺码</span><button v-for="size in detailProduct(section).sizes" :key="size" class="detail-size">{{ size }}</button></div><div v-if="detailProduct(section).detail" class="detail-long-copy">{{ detailProduct(section).detail }}</div><div v-if="detailProduct(section).detailImages?.length" class="detail-story-images"><img v-for="image in detailProduct(section).detailImages" :key="image" :src="mpUrl(image)" :alt="detailProduct(section).name + ' 商品详情'"></div><div v-if="section.props.showActions" class="detail-actions"><button @click.stop="addToCart(detailProduct(section))">加入购物车</button><button class="primary" @click.stop="addToCart(detailProduct(section),true)">立即购买</button></div></div></div>
                        <div v-else-if="section.type === 'appointment-hero'" class="appointment-editor-hero"><span>{{ section.props.kicker }}</span><h2>{{ section.props.title }}</h2><p>{{ section.props.description }}</p></div>
                        <div v-else-if="section.type === 'appointment-form'" class="appointment-editor-form"><div v-if="section.props.showName || section.props.showPhone" class="appointment-editor-card"><b>01</b><h3>预约人信息</h3><label v-if="section.props.showName">姓名<input placeholder="请输入预约人姓名" disabled></label><label v-if="section.props.showPhone">联系电话<input placeholder="请输入手机号" disabled></label></div><div v-if="section.props.showService || section.props.showStore" class="appointment-editor-card"><b>02</b><h3>服务选择</h3><div v-if="section.props.showService" class="appointment-editor-options"><button type="button">量体与定制咨询</button><button type="button">成衣选购咨询</button></div><label v-if="section.props.showStore">到店门店<select disabled><option>由实时数据提供</option></select></label></div><div v-if="section.props.showDate || section.props.showTime" class="appointment-editor-card"><b>03</b><h3>日期与时间</h3><div class="appointment-editor-date"><button type="button">周六<br><strong>16</strong></button><button type="button">周日<br><strong>17</strong></button></div><div v-if="section.props.showTime" class="appointment-editor-slots"><button type="button">14:00</button><button type="button">16:30</button></div></div><div v-if="section.props.showAdvisor" class="appointment-editor-card"><b>04</b><h3>专属顾问</h3><p class="appointment-editor-live">顾问选项由飞书实时数据提供</p></div></div>
                        <div v-else-if="section.type === 'appointment-notes'" class="appointment-editor-card appointment-editor-notes"><b>05</b><h3>{{ section.props.label }}</h3><textarea :placeholder="section.props.placeholder" disabled></textarea></div>
                        <div v-else-if="section.type === 'appointment-submit'" class="appointment-editor-submit"><button type="button">{{ section.props.buttonText }}</button></div>
                        <div v-else-if="section.type === 'text'" class="text-section"><h3 class="serif">{{ section.props.title }}</h3><p>{{ section.props.text }}</p></div>
                        <div v-else-if="section.type === 'spacer'"></div>
                        <div v-if="section.type !== 'hero' && section.type !== 'media'" class="hotspot-surface" :class="{editing:hotspotEditMode && selectedId===section.id}" @pointerdown="beginHotspotDraw($event, section.props)">
                          <button v-for="(hotspot,hotspotIndex) in section.props.hotspots" :key="hotspot.id" type="button" class="hotspot-marker" :class="{selected:selectedHotspotId===hotspot.id}" :style="hotspotStyle(hotspot)" :aria-label="hotspot.label" @pointerdown.stop="beginHotspotPointer($event,hotspot,'move')" @click.stop="hotspotEditMode ? selectedHotspotId=hotspot.id : navigatePreview(hotspot)"><span>{{ hotspotIndex + 1 }}</span><i v-if="hotspotEditMode && selectedHotspotId===hotspot.id" class="hotspot-resize" @pointerdown.stop="beginHotspotPointer($event,hotspot,'resize')"></i></button>
                        </div>
                      </section>
                    </template>

                    <nav v-if="currentPageMeta.tab" class="mobile-tabbar" aria-label="小程序预览导航">
                      <button class="mobile-tab" :class="{active:currentPage==='home'}" @click.stop="switchPage('home')"><img :src="mpUrl(currentPage==='home' ? cfg.tabBar.items[0].iconOn : cfg.tabBar.items[0].icon)" alt=""><span>{{ cfg.tabBar.items[0].text }}</span></button>
                      <button class="mobile-tab" :class="{active:currentPage==='category'}" @click.stop="switchPage('category')"><img :src="mpUrl(currentPage==='category' ? cfg.tabBar.items[1].iconOn : cfg.tabBar.items[1].icon)" alt=""><span>{{ cfg.tabBar.items[1].text }}</span></button>
                      <button class="mobile-tab center" :class="{active:currentPage==='campaign'}" :style="centerTabStyle" @click.stop="switchPage('campaign')"><img :src="mpUrl(cfg.tabBar.items[2].centerIcon)" alt=""><span>{{ cfg.tabBar.items[2].text }}</span></button>
                      <button class="mobile-tab" :class="{active:currentPage==='cart'}" @click.stop="switchPage('cart')"><img :src="mpUrl(currentPage==='cart' ? cfg.tabBar.items[3].iconOn : cfg.tabBar.items[3].icon)" alt=""><span>{{ cfg.tabBar.items[3].text }}</span></button>
                      <button class="mobile-tab" :class="{active:currentPage==='mine'}" @click.stop="switchPage('mine')"><img :src="mpUrl(currentPage==='mine' ? cfg.tabBar.items[4].iconOn : cfg.tabBar.items[4].icon)" alt=""><span>{{ cfg.tabBar.items[4].text }}</span></button>
                    </nav>
                    <section v-if="servicePreview.open" class="preview-service-panel" aria-label="智能客服预览" @click.stop>
                      <template v-if="servicePreview.screen==='chat'">
                        <header class="preview-service-head"><div class="preview-service-mark">P</div><div><strong>PRIVLAN 专属服务</strong><span><i></i>在线服务</span></div><button type="button" title="关闭客服预览" aria-label="关闭客服预览" @click="closeServicePreview"><iconify-icon class="icon" icon="ph:x"></iconify-icon></button></header>
                        <div class="preview-service-messages"><div class="preview-service-kicker">PRIVLAN CLIENT SERVICE</div><div v-for="item in servicePreview.messages" :key="item.id" class="preview-message" :class="item.role"><div><p>{{ item.text }}</p><button v-if="item.action==='appointment'" type="button" @click="openPreviewAppointment">进入预约</button><button v-if="item.action==='measurements'" type="button" @click="previewServicePrompt('模拟量体信息')">查看模拟说明</button><button v-if="item.action==='human'" type="button" disabled>{{ cfg.serviceBot.humanServiceEnabled ? '真机打开人工客服' : '人工客服暂未开通' }}</button></div></div></div>
                        <div class="preview-service-composer"><div class="preview-service-prompts"><button v-for="prompt in cfg.serviceBot.quickPrompts" :key="prompt" type="button" @click="previewServicePrompt(prompt)">{{ prompt }}</button></div><form @submit.prevent="previewServicePrompt()"><input v-model="servicePreview.draft" type="text" maxlength="200" placeholder="输入你想了解的问题"><button type="submit" :disabled="!servicePreview.draft.trim()">发送</button></form><small>预览使用模拟数据，不会读取飞书客户资料。</small></div>
                      </template>
                    </section>
                    <button v-if="cfg.serviceBot?.enabled !== false && !servicePreview.open" type="button" class="preview-service-bot" :class="{dragging:serviceBotDrag.active,desktop:device==='desktop'}" :style="serviceBotStyle" title="轻触打开客服，拖动调整位置" aria-label="打开在线客服" @pointerdown.stop="beginServiceBotDrag" @pointermove.stop="moveServiceBotDrag" @pointerup.stop="endServiceBotDrag" @pointercancel.stop="endServiceBotDrag" @click.stop="serviceBotClick"><img :src="mpUrl(cfg.serviceBot.icon)" alt="在线客服"></button>
                  </div>
                </div>
              </div>
              <div class="canvas-footer">
                <div class="device-switch"><button :class="{active: device === 'mobile'}" title="手机" @click="device = 'mobile'"><iconify-icon class="icon" icon="ph:device-mobile"></iconify-icon></button><button :class="{active: device === 'tablet'}" title="平板" @click="device = 'tablet'"><iconify-icon class="icon" icon="ph:device-tablet"></iconify-icon></button><button :class="{active: device === 'desktop'}" title="桌面" @click="device = 'desktop'"><iconify-icon class="icon" icon="ph:desktop"></iconify-icon></button></div>
                <div class="zoom-control"><iconify-icon class="icon" icon="ph:magnifying-glass-minus"></iconify-icon><input v-model="zoom" type="range" min="55" max="110"><span>{{ zoom }}%</span></div>
              </div>
            </section>

            <aside class="side-panel right right-panel" :class="{open:rightPanelOpen}">
              <div class="panel-header"><div><div class="panel-title">属性面板</div><div class="panel-subtitle">{{ selectedSection ? blockLabel(selectedSection) : '未选择区块' }}</div></div><div class="panel-header-actions"><button v-if="selectedSection" class="icon-btn" title="取消选择区块" aria-label="取消选择区块" @click="selectedId = null"><iconify-icon class="icon" icon="ph:x"></iconify-icon></button><button class="icon-btn panel-close" title="收起属性面板" @click="togglePanel('right')"><iconify-icon class="icon" icon="ph:sidebar-simple"></iconify-icon></button></div></div>
              <div v-if="selectedSection" class="inspector-status"><div><span class="status-ring"></span>{{ hasStyleOverrides ? '全局样式已覆盖' : '跟随全局样式' }}</div><button @click="resetSectionStyle()">恢复全局</button></div>
              <div class="inspector-tabs"><button v-for="tab in [{id:'content',name:'内容'},{id:'style',name:'样式'},{id:'motion',name:'动效'},{id:'advanced',name:'高级'}]" :key="tab.id" class="inspector-tab" :class="{active: inspectorTab === tab.id}" @click="inspectorTab = tab.id">{{ tab.name }}</button></div>
              <div v-if="!selectedSection" class="selection-empty"><iconify-icon class="icon" icon="ph:cursor-click"></iconify-icon><div>在画布中选择一个区块</div></div>
              <div v-else class="inspector-content">
                <template v-if="inspectorTab === 'content'">
                  <div class="field-group"><div class="field-title">基础信息</div><div class="field"><label>区块名称</label><input v-model="selectedSection.name" type="text"></div></div>
                  <div v-if="selectedSection.type === 'hero'" class="field-group hero-editor-group">
                    <div class="field-title"><span>轮播媒体</span><span>{{ selectedSection.props.slides.length }} 项</span></div>
                    <div class="slide-filmstrip">
                      <button v-for="(slide,index) in selectedSection.props.slides" :key="slide.id" class="slide-thumb" :class="{active:selectedSlideIndex===index}" draggable="true" @dragstart="beginSlideDrag(index)" @dragover.prevent @drop="dropSlide(index)" @click="selectHeroSlide(index)">
                        <video v-if="slide.kind==='video'" :src="mpUrl(slide.src)" muted></video><img v-else :src="mpUrl(slide.src)" :alt="slide.title">
                        <span class="slide-number">{{ index + 1 }}</span><iconify-icon v-if="slide.kind==='video'" class="slide-kind" icon="ph:play-fill"></iconify-icon>
                      </button>
                      <button class="slide-add" title="添加媒体" @click="openMediaPicker('add')"><iconify-icon class="icon" icon="ph:plus"></iconify-icon></button>
                    </div>
                    <div class="media-actions"><button class="btn small" @click="openMediaPicker('add')"><iconify-icon class="icon" icon="ph:images"></iconify-icon>从媒体库选择</button><label class="btn small"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon>上传图片/视频<input type="file" accept="image/*,video/*" multiple hidden @change="uploadFiles($event.target.files,true);$event.target.value=''" /></label></div>
                    <template v-if="selectedHeroSlide">
                      <div class="slide-edit-toolbar"><span>正在编辑第 {{ selectedSlideIndex + 1 }} 张</span><div><button title="前移" @click="moveHeroSlide(selectedSlideIndex,-1)"><iconify-icon class="icon" icon="ph:arrow-left"></iconify-icon></button><button title="后移" @click="moveHeroSlide(selectedSlideIndex,1)"><iconify-icon class="icon" icon="ph:arrow-right"></iconify-icon></button><button title="替换媒体" @click="openMediaPicker('replace')"><iconify-icon class="icon" icon="ph:arrows-clockwise"></iconify-icon></button><button class="slide-delete" title="删除当前图片" @click="removeHeroSlide(selectedSlideIndex)"><iconify-icon class="icon" icon="ph:trash"></iconify-icon><span>删除图片</span></button></div></div>
                      <div class="toggle-row"><span>显示标题与副标题</span><button class="switch" :class="{on:selectedHeroSlide.showContent !== false}" @click="selectedHeroSlide.showContent = selectedHeroSlide.showContent === false"></button></div>
                      <div v-if="selectedHeroSlide.showContent !== false" class="field"><label>标题</label><input v-model="selectedHeroSlide.title" type="text"></div>
                      <div v-if="selectedHeroSlide.showContent !== false" class="field"><label>副标题</label><textarea v-model="selectedHeroSlide.subtitle"></textarea></div>
                      <div class="toggle-row"><span>显示行动按钮</span><button class="switch" :class="{on:selectedHeroSlide.showButton}" @click="selectedHeroSlide.showButton = !selectedHeroSlide.showButton"></button></div>
                      <div v-if="selectedHeroSlide.showButton" class="field"><label>按钮文字</label><input v-model="selectedHeroSlide.buttonText" type="text"></div>
                      <div class="field"><label>跳转类型</label><select v-model="selectedHeroSlide.linkType" @change="updateHeroLinkType(selectedHeroSlide)"><option value="page">小程序页面</option><option value="product">商品详情</option><option value="category">商品分类</option><option value="external">网页链接</option></select></div>
                      <div class="field"><label>跳转目标</label><select v-if="selectedHeroSlide.linkType==='page'" v-model="selectedHeroSlide.linkValue"><option v-for="page in pageDefinitions" :key="page.id" :value="page.path">{{ page.name }}</option></select><select v-else-if="selectedHeroSlide.linkType==='product'" v-model="selectedHeroSlide.linkValue"><option v-for="product in cfg.products" :key="product.id" :value="'/pages/detail/detail?id='+product.id">{{ product.name }} · {{ money(product.price) }}</option></select><select v-else-if="selectedHeroSlide.linkType==='category'" v-model="selectedHeroSlide.linkValue"><option v-for="cat in cfg.categories" :key="cat.id" :value="'/pages/category/category?cat='+cat.id">{{ cat.name }}</option></select><input v-else v-model="selectedHeroSlide.linkValue" type="url" placeholder="https://example.com"></div>
                    </template>
                  </div>
                  <div v-else-if="selectedSection.type === 'media'" class="field-group"><div class="field-title">背景内容</div><div class="field"><label>背景类型</label><div class="choice-grid"><button :class="{active:selectedSection.props.mode==='color'}" @click="selectedSection.props.mode='color'">纯色</button><button :class="{active:selectedSection.props.mode==='image'}" @click="selectedSection.props.mode='image'">图片</button><button :class="{active:selectedSection.props.mode==='video'}" @click="selectedSection.props.mode='video'">视频</button></div></div><div v-if="selectedSection.props.mode==='color'" class="field"><label>背景颜色</label><div class="color-field"><input v-model="selectedSection.style.backgroundColor" type="color"><input v-model="selectedSection.style.backgroundColor" type="text"></div></div><div v-if="selectedSection.props.mode==='color'" class="media-actions"><button class="btn small" @click="openSectionMediaPicker"><iconify-icon class="icon" icon="ph:images"></iconify-icon>从媒体库选择</button><label class="btn small"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon>上传图片/视频<input type="file" accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov" hidden @change="uploadSectionMedia($event.target.files);$event.target.value=''" /></label></div><template v-else><div v-if="selectedSection.props.src" class="section-media-preview"><video v-if="selectedSection.props.mode==='video'" :src="mpUrl(selectedSection.props.src)" muted></video><img v-else :src="mpUrl(selectedSection.props.src)" alt=""></div><div class="media-actions"><button class="btn small" @click="openSectionMediaPicker"><iconify-icon class="icon" icon="ph:images"></iconify-icon>从媒体库选择</button><label class="btn small"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon>上传图片/视频<input type="file" accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov" hidden @change="uploadSectionMedia($event.target.files);$event.target.value=''" /></label></div><div class="field"><label>媒体路径</label><input v-model="selectedSection.props.src" type="text" placeholder="/images/background.jpg"></div><div class="field-row"><div class="field"><label>填充方式</label><select v-model="selectedSection.props.fit"><option value="cover">铺满</option><option value="contain">完整显示</option></select></div><div class="field"><label>画面位置</label><select v-model="selectedSection.props.position"><option value="center">居中</option><option value="top">顶部</option><option value="bottom">底部</option><option value="left">左侧</option><option value="right">右侧</option></select></div></div></template><p class="media-format-note">图片支持 JPG、JPEG、PNG、WebP、GIF；视频支持 MP4（推荐）、WebM、MOV；单个文件不超过 80MB。</p><div class="field"><label>点击跳转</label><select v-model="selectedSection.props.linkType" @change="selectedSection.props.linkType ? updateHeroLinkType(selectedSection.props) : selectedSection.props.linkValue='' "><option value="">不跳转</option><option value="page">小程序页面</option><option value="product">商品详情</option><option value="category">商品分类</option><option value="external">网页链接</option></select></div><div v-if="selectedSection.props.linkType" class="field"><label>跳转目标</label><select v-if="selectedSection.props.linkType==='page'" v-model="selectedSection.props.linkValue"><option v-for="page in pageDefinitions" :key="page.id" :value="page.path">{{ page.name }}</option></select><select v-else-if="selectedSection.props.linkType==='product'" v-model="selectedSection.props.linkValue"><option v-for="product in cfg.products" :key="product.id" :value="'/pages/detail/detail?id='+product.id">{{ product.name }} · {{ money(product.price) }}</option></select><select v-else-if="selectedSection.props.linkType==='category'" v-model="selectedSection.props.linkValue"><option v-for="cat in cfg.categories" :key="cat.id" :value="'/pages/category/category?cat='+cat.id">{{ cat.name }}</option></select><input v-else v-model="selectedSection.props.linkValue" type="url" placeholder="https://example.com"></div></div>
                  <div v-else-if="selectedSection.type === 'categories'" class="field-group"><div class="field-title">分类来源</div><div class="field"><label>显示数量 <span>{{ selectedSection.props.count || 5 }}</span></label><div class="range-row"><input v-model.number="selectedSection.props.count" type="range" min="2" :max="cfg.categories.length"><input v-model.number="selectedSection.props.count" type="number" min="2" :max="cfg.categories.length"></div></div><button class="btn small" @click="switchView('categories')">管理分类</button></div>
                  <div v-else-if="selectedSection.type === 'product-grid'" class="field-group"><div class="field-title">商品数据</div><div class="field"><label>区块标题</label><input v-model="selectedSection.props.title" type="text"></div><div class="field"><label>商品分类</label><select v-model="selectedSection.props.category"><option value="all">全部商品</option><option v-for="cat in cfg.categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option></select></div><div class="field"><label>显示数量 <span>{{ selectedSection.props.count || 6 }}</span></label><div class="range-row"><input v-model.number="selectedSection.props.count" type="range" min="1" max="12"><input v-model.number="selectedSection.props.count" type="number" min="1" max="12"></div></div><div class="toggle-row"><span>显示商品名称</span><button class="switch" :class="{on:selectedSection.props.showName}" @click="selectedSection.props.showName = !selectedSection.props.showName"></button></div><div class="toggle-row"><span>显示价格</span><button class="switch" :class="{on:selectedSection.props.showPrice}" @click="selectedSection.props.showPrice = !selectedSection.props.showPrice"></button></div></div>
                  <div v-else-if="selectedSection.type === 'member-banner'" class="field-group"><div class="field-title">会员内容</div><div class="toggle-row"><span>使用 PRIVLAN 品牌标志</span><button class="switch" :class="{on:selectedSection.props.useBrandLogo !== false}" @click="selectedSection.props.useBrandLogo = selectedSection.props.useBrandLogo === false"></button></div><div v-if="selectedSection.props.useBrandLogo === false" class="field"><label>品牌标题</label><input v-model="selectedSection.props.title" type="text"></div><div class="field"><label>说明文字</label><textarea v-model="selectedSection.props.subtitle"></textarea></div><div class="field-title benefit-link-title">权益点击跳转</div><div v-for="(benefit,index) in cfg.memberBenefits.slice(0,4)" :key="'benefit-link-' + index" class="field"><label>{{ benefit.text || ('权益 ' + (index + 1)) }}</label><select v-model="benefit.linkValue"><option value="/pages/category/category?cat=new">早秋新品</option><option v-for="page in pageDefinitions" :key="page.id" :value="page.path">{{ page.name }}</option><option value="/pages/service-chat/index">智能客服</option></select></div></div>
                  <div v-else-if="selectedSection.type === 'product-detail'" class="field-group"><div class="field-title">商品详情</div><div class="field"><label>预览商品</label><select v-model.number="selectedSection.props.productId"><option v-for="product in cfg.products" :key="product.id" :value="product.id">{{ product.name }} · {{ money(product.price) }}</option></select></div><div class="toggle-row"><span>显示价格</span><button class="switch" :class="{on:selectedSection.props.showPrice}" @click="selectedSection.props.showPrice=!selectedSection.props.showPrice"></button></div><div class="toggle-row"><span>显示购买按钮</span><button class="switch" :class="{on:selectedSection.props.showActions}" @click="selectedSection.props.showActions=!selectedSection.props.showActions"></button></div></div>
                  <div v-else-if="selectedSection.type === 'appointment-hero'" class="field-group"><div class="field-title">预约页标题</div><div class="field"><label>英文标识</label><input v-model="selectedSection.props.kicker" type="text"></div><div class="field"><label>主标题</label><input v-model="selectedSection.props.title" type="text"></div><div class="field"><label>说明文字</label><textarea v-model="selectedSection.props.description"></textarea></div><div class="field-title">头图媒体</div><div v-if="selectedSection.props.backgroundSrc" class="section-media-preview"><img :src="mpUrl(selectedSection.props.backgroundSrc)" alt="预约头图"></div><div class="media-actions"><button class="btn small" @click="openSectionMediaPicker"><iconify-icon class="icon" icon="ph:images"></iconify-icon>从媒体库选择</button><label class="btn small"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon>上传图片<input type="file" accept="image/*,.jpg,.jpeg,.png,.webp" hidden @change="uploadSectionMedia($event.target.files);$event.target.value=''" /></label></div><div class="field-row"><div class="field"><label>填充方式</label><select v-model="selectedSection.props.backgroundFit"><option value="cover">铺满</option><option value="contain">完整显示</option></select></div><div class="field"><label>画面位置</label><select v-model="selectedSection.props.backgroundPosition"><option value="center">居中</option><option value="top">顶部</option><option value="bottom">底部</option><option value="left">左侧</option><option value="right">右侧</option></select></div></div></div>
                  <div v-else-if="selectedSection.type === 'appointment-form'" class="field-group"><div class="field-title">预约字段</div><p class="field-help">字段顺序按预约流程固定，门店、顾问和时段选项由飞书实时提供。关闭字段后，小程序也会跳过对应校验。</p><div v-for="field in [{key:'showName',label:'姓名'},{key:'showPhone',label:'联系电话'},{key:'showService',label:'预约服务'},{key:'showStore',label:'到店门店'},{key:'showDate',label:'预约日期'},{key:'showTime',label:'预约时间'},{key:'showAdvisor',label:'专属顾问'}]" :key="field.key" class="toggle-row"><span>{{ field.label }}</span><button class="switch" :class="{on:selectedSection.props[field.key] !== false}" @click="selectedSection.props[field.key] = selectedSection.props[field.key] === false"></button></div></div>
                  <div v-else-if="selectedSection.type === 'appointment-notes'" class="field-group"><div class="field-title">备注字段</div><div class="field"><label>字段标题</label><input v-model="selectedSection.props.label" type="text"></div><div class="field"><label>输入提示</label><textarea v-model="selectedSection.props.placeholder"></textarea></div></div>
                  <div v-else-if="selectedSection.type === 'appointment-submit'" class="field-group"><div class="field-title">提交与成功反馈</div><div class="field"><label>按钮文字</label><input v-model="selectedSection.props.buttonText" type="text"></div><div class="field"><label>成功标题</label><input v-model="selectedSection.props.successTitle" type="text"></div><div class="field"><label>成功说明</label><textarea v-model="selectedSection.props.successCopy"></textarea></div></div>
                  <div v-else-if="selectedSection.type === 'text'" class="field-group"><div class="field-title">文字内容</div><div class="field"><label>标题</label><input v-model="selectedSection.props.title" type="text"></div><div class="field"><label>正文</label><textarea v-model="selectedSection.props.text"></textarea></div></div>
                  <div v-if="hotspotOwner" class="field-group hotspot-editor-panel">
                    <div class="field-title"><span>点击热区</span><span>{{ currentHotspots.length }} 个</span></div>
                    <div class="hotspot-editor-actions"><button class="btn small" :class="{gold:hotspotEditMode}" @click="hotspotEditMode=!hotspotEditMode"><iconify-icon class="icon" icon="ph:selection"></iconify-icon>{{ hotspotEditMode ? '退出热区编辑' : '进入热区编辑' }}</button><button class="btn small" @click="addHotspot()"><iconify-icon class="icon" icon="ph:plus"></iconify-icon>添加热区</button></div>
                    <p class="hotspot-help">进入编辑后，可直接在画面上拖拽圈选；拖动区域可移动，拖动右下角可缩放。</p>
                    <div v-if="currentHotspots.length" class="hotspot-list"><button v-for="(hotspot,index) in currentHotspots" :key="hotspot.id" :class="{active:selectedHotspotId===hotspot.id}" @click="selectedHotspotId=hotspot.id;hotspotEditMode=true"><span>{{ index + 1 }}</span><strong>{{ hotspot.label }}</strong><iconify-icon class="icon" icon="ph:caret-right"></iconify-icon></button></div>
                    <div v-else class="hotspot-empty">当前画面还没有点击热区</div>
                    <template v-if="selectedHotspot">
                      <div class="field hotspot-divider"><label>热区名称</label><input v-model="selectedHotspot.label" type="text" maxlength="24"></div>
                      <div class="field"><label>跳转类型</label><select v-model="selectedHotspot.linkType" @change="updateHotspotLinkType(selectedHotspot)"><option value="page">小程序页面</option><option value="product">商品详情</option><option value="category">商品分类</option><option value="external">网页链接</option></select></div>
                      <div class="field"><label>跳转目标</label><select v-if="selectedHotspot.linkType==='page'" v-model="selectedHotspot.linkValue"><option v-for="page in pageDefinitions" :key="page.id" :value="page.path">{{ page.name }}</option></select><select v-else-if="selectedHotspot.linkType==='product'" v-model="selectedHotspot.linkValue"><option v-for="product in cfg.products" :key="product.id" :value="'/pages/detail/detail?id='+product.id">{{ product.name }} · {{ money(product.price) }}</option></select><select v-else-if="selectedHotspot.linkType==='category'" v-model="selectedHotspot.linkValue"><option v-for="cat in cfg.categories" :key="cat.id" :value="'/pages/category/category?cat='+cat.id">{{ cat.name }}</option></select><input v-else v-model="selectedHotspot.linkValue" type="url" placeholder="https://example.com"></div>
                      <div class="hotspot-coordinate-grid"><div class="field"><label>X (%)</label><input v-model.number="selectedHotspot.x" type="number" min="0" max="96" step="0.1" @change="normalizeHotspotInPlace(selectedHotspot)"></div><div class="field"><label>Y (%)</label><input v-model.number="selectedHotspot.y" type="number" min="0" max="96" step="0.1" @change="normalizeHotspotInPlace(selectedHotspot)"></div><div class="field"><label>宽度 (%)</label><input v-model.number="selectedHotspot.width" type="number" min="4" max="100" step="0.1" @change="normalizeHotspotInPlace(selectedHotspot)"></div><div class="field"><label>高度 (%)</label><input v-model.number="selectedHotspot.height" type="number" min="4" max="100" step="0.1" @change="normalizeHotspotInPlace(selectedHotspot)"></div></div>
                      <button class="btn danger hotspot-delete" @click="removeHotspot()"><iconify-icon class="icon" icon="ph:trash"></iconify-icon>删除当前热区</button>
                    </template>
                  </div>
                </template>

                <template v-else-if="inspectorTab === 'style'">
                  <div class="override-banner" :class="{active:hasStyleOverrides}"><div><iconify-icon class="icon" :icon="hasStyleOverrides ? 'ph:sparkle-fill' : 'ph:link'"></iconify-icon><span>{{ hasStyleOverrides ? '已覆盖全局样式' : '正在使用全局样式' }}</span></div><button @click="resetSectionStyle()">恢复全局默认</button></div>
                  <details class="inspector-disclosure" open><summary>背景与文字 <iconify-icon class="icon" icon="ph:caret-down"></iconify-icon></summary><div class="disclosure-body"><div class="field"><label>背景颜色</label><div class="color-field"><input v-model="selectedSection.style.backgroundColor" type="color"><input v-model="selectedSection.style.backgroundColor" type="text"></div></div><div class="field"><label>文字颜色</label><div class="color-field"><input v-model="selectedSection.style.textColor" type="color"><input v-model="selectedSection.style.textColor" type="text"></div></div></div></details>
                  <details class="inspector-disclosure" open><summary>字体排版 <iconify-icon class="icon" icon="ph:caret-down"></iconify-icon></summary><div class="disclosure-body">
                    <div class="field"><label>字体组合 <span v-if="systemFonts.length">含 {{ systemFonts.length }} 款电脑字体</span></label><select v-model="selectedSection.style.fontFamily"><optgroup label="推荐组合"><option v-for="font in fontPresets" :key="font.id" :value="font.id">{{ font.name }}</option></optgroup><optgroup v-if="cfg.customFonts.length" label="已打包字体"><option v-for="font in cfg.customFonts" :key="font.id" :value="font.id">{{ font.name }}</option></optgroup><optgroup v-if="systemFonts.length" label="此电脑上的字体"><option v-for="font in systemFonts" :key="font.name" :value="'system:'+font.name">{{ font.name }}</option></optgroup></select></div>
                    <div class="field"><label>字号 <span>{{ selectedSection.style.fontSize }} px</span></label><div class="range-row"><input v-model.number="selectedSection.style.fontSize" type="range" min="9" max="64"><input v-model.number="selectedSection.style.fontSize" type="number" min="9" max="64"></div></div>
                    <div class="field"><label>字重</label><div class="choice-grid five"><button v-for="weight in [300,400,500,600,700]" :key="weight" :class="{active:selectedSection.style.fontWeight===weight}" @click="selectedSection.style.fontWeight=weight">{{ weight }}</button></div></div>
                    <div class="field"><label>对齐</label><div class="choice-grid"><button v-for="align in [{id:'left',icon:'ph:text-align-left'},{id:'center',icon:'ph:text-align-center'},{id:'right',icon:'ph:text-align-right'}]" :key="align.id" :class="{active:selectedSection.style.textAlign===align.id}" @click="selectedSection.style.textAlign=align.id"><iconify-icon class="icon" :icon="align.icon"></iconify-icon></button></div></div>
                    <div class="field-row"><div class="field"><label>字间距</label><input v-model.number="selectedSection.style.letterSpacing" type="number" step="0.1"></div><div class="field"><label>行高</label><input v-model.number="selectedSection.style.lineHeight" type="number" min="1" max="2.4" step="0.1"></div></div>
                    <div class="media-actions"><button v-if="selectedSection.style.fontFamily?.startsWith('system:')" class="btn small gold" @click="importSelectedSystemFont"><iconify-icon class="icon" icon="ph:package"></iconify-icon>{{ fontUploading ? '打包中…' : '打包当前字体' }}</button><label class="btn small"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon>{{ fontUploading ? '上传中…' : '上传字体' }}<input type="file" accept=".woff2,.woff,.ttf,.otf,.ttc" hidden @change="uploadFontFiles($event.target.files);$event.target.value=''" /></label><button class="btn small" @click="addCustomFontUrl"><iconify-icon class="icon" icon="ph:link"></iconify-icon>填写字体地址</button></div><p class="font-note">电脑字体可直接用于后台预览；同步前只打包实际选择的字体，避免把全部字体塞进小程序。请确认商业授权，优先选择体积较小的字体。</p>
                  </div></details>
                  <details class="inspector-disclosure" open><summary>区块间距与边框 <iconify-icon class="icon" icon="ph:caret-down"></iconify-icon></summary><div class="disclosure-body"><div class="field"><label>上外边距 <span>{{ selectedSection.style.marginTop }} px</span></label><div class="range-row"><input v-model.number="selectedSection.style.marginTop" type="range" min="0" max="240" step="1"><input v-model.number="selectedSection.style.marginTop" type="number" min="0" max="240"></div></div><div class="field"><label>下外边距 <span>{{ selectedSection.style.marginBottom }} px</span></label><div class="range-row"><input v-model.number="selectedSection.style.marginBottom" type="range" min="0" max="240" step="1"><input v-model.number="selectedSection.style.marginBottom" type="number" min="0" max="240"></div></div><p class="field-help">用于调整当前区块与前后区块之间的留白，所有页面区块均独立保存。</p><div class="field-row"><div class="field"><label>水平内边距</label><input v-model.number="selectedSection.style.paddingX" type="number" min="0" max="120"></div><div class="field"><label>垂直内边距</label><input v-model.number="selectedSection.style.paddingY" type="number" min="0" max="180"></div></div><div class="field-row"><div class="field"><label>边框宽度</label><input v-model.number="selectedSection.style.borderWidth" type="number" min="0"></div><div class="field"><label>圆角</label><input v-model.number="selectedSection.style.borderRadius" type="number" min="0"></div></div><div class="field"><label>边框颜色</label><div class="color-field"><input v-model="selectedSection.style.borderColor" type="color"><input v-model="selectedSection.style.borderColor" type="text"></div></div></div></details>
                  <details v-if="selectedSection.type==='hero'" class="inspector-disclosure"><summary>行动按钮 <iconify-icon class="icon" icon="ph:caret-down"></iconify-icon></summary><div class="disclosure-body"><div v-for="(label,key) in {buttonTextColor:'文字颜色',buttonBackground:'背景颜色',buttonBorderColor:'边框颜色'}" :key="key" class="field"><label>{{ label }}</label><div class="color-field"><input v-model="selectedSection.style[key]" type="color"><input v-model="selectedSection.style[key]" type="text"></div></div><div class="field-row"><div class="field"><label>边框宽度</label><input v-model.number="selectedSection.style.buttonBorderWidth" type="number" min="0"></div><div class="field"><label>按钮圆角</label><input v-model.number="selectedSection.style.buttonRadius" type="number" min="0"></div></div><div class="field"><label>按钮字号</label><input v-model.number="selectedSection.style.buttonFontSize" type="number" min="9" max="28"></div></div></details>
                  <details v-if="selectedSection.type==='product-grid'" class="inspector-disclosure"><summary>商品网格 <iconify-icon class="icon" icon="ph:caret-down"></iconify-icon></summary><div class="disclosure-body"><div class="field"><label>每行列数</label><div class="choice-grid"><button v-for="n in [2,3,4]" :key="n" :class="{active:selectedSection.props.columns===n}" @click="selectedSection.props.columns=n">{{ n }} 列</button></div></div><div class="field"><label>商品间距</label><div class="range-row"><input v-model.number="selectedSection.style.gap" type="range" min="4" max="24"><input v-model.number="selectedSection.style.gap" type="number"></div></div></div></details>
                </template>

                <template v-else-if="inspectorTab === 'motion'">
                  <div v-if="selectedSection.type==='hero'" class="field-group"><div class="field-title">轮播与画面</div><div class="field"><label>区块高度 <span>{{ selectedSection.style.height }} px</span></label><div class="range-row"><input v-model.number="selectedSection.style.height" type="range" min="280" max="760"><input v-model.number="selectedSection.style.height" type="number"></div></div><div class="field"><label>遮罩强度 <span>{{ selectedSection.style.overlay }}%</span></label><div class="range-row"><input v-model.number="selectedSection.style.overlay" type="range" min="0" max="80"><input v-model.number="selectedSection.style.overlay" type="number"></div></div><div class="toggle-row"><span>自动播放</span><button class="switch" :class="{on:selectedSection.props.autoplay}" @click="selectedSection.props.autoplay=!selectedSection.props.autoplay"></button></div><div class="field"><label>轮播间隔 <span>{{ selectedSection.props.interval }} 秒</span></label><div class="range-row"><input v-model.number="selectedSection.props.interval" type="range" min="2" max="15"><input v-model.number="selectedSection.props.interval" type="number"></div></div><div class="field"><label>切换效果</label><select v-model="selectedSection.props.transition"><option value="fade">淡入淡出</option><option value="slide">水平滑动</option><option value="none">无动效</option></select></div></div>
                  <div v-else-if="selectedSection.type==='media'" class="field-group"><div class="field-title">画面与播放</div><div class="field"><label>区块高度 <span>{{ selectedSection.style.height }} px</span></label><div class="range-row"><input v-model.number="selectedSection.style.height" type="range" min="80" max="900"><input v-model.number="selectedSection.style.height" type="number" min="80" max="900"></div></div><div v-if="selectedSection.props.mode!=='color'" class="field"><label>遮罩强度 <span>{{ selectedSection.style.overlay || 0 }}%</span></label><div class="range-row"><input v-model.number="selectedSection.style.overlay" type="range" min="0" max="80"><input v-model.number="selectedSection.style.overlay" type="number" min="0" max="80"></div></div><template v-if="selectedSection.props.mode==='video'"><div class="toggle-row"><span>自动播放</span><button class="switch" :class="{on:selectedSection.props.autoplay}" @click="selectedSection.props.autoplay=!selectedSection.props.autoplay"></button></div><div class="toggle-row"><span>循环播放</span><button class="switch" :class="{on:selectedSection.props.loop}" @click="selectedSection.props.loop=!selectedSection.props.loop"></button></div><div class="toggle-row"><span>静音</span><button class="switch" :class="{on:selectedSection.props.muted}" @click="selectedSection.props.muted=!selectedSection.props.muted"></button></div><div class="toggle-row"><span>显示播放控件</span><button class="switch" :class="{on:selectedSection.props.controls}" @click="selectedSection.props.controls=!selectedSection.props.controls"></button></div></template></div>
                  <div v-else class="empty-panel"><iconify-icon class="icon" icon="ph:magic-wand"></iconify-icon><h3>暂无区块动效</h3><p>当前区块保持轻盈稳定，后续可以按需增加进入与滚动效果。</p></div>
                </template>

                <template v-else>
                  <div class="field-group"><div class="field-title">显示状态</div><div class="toggle-row"><span>启用区块</span><button class="switch" :class="{on:selectedSection.enabled}" @click="selectedSection.enabled = !selectedSection.enabled"></button></div></div>
                  <div class="field-group"><div class="field-title">设备可见性</div><div v-for="item in [{id:'mobile',name:'手机'},{id:'tablet',name:'平板'},{id:'desktop',name:'桌面'}]" :key="item.id" class="toggle-row"><span>{{ item.name }}</span><button class="switch" :class="{on:selectedSection.visibility[item.id]}" @click="selectedSection.visibility[item.id] = !selectedSection.visibility[item.id]"></button></div></div>
                  <div class="field-group"><button class="btn" @click="resetSectionStyle()"><iconify-icon class="icon" icon="ph:arrow-counter-clockwise"></iconify-icon>恢复全局默认</button></div>
                  <div class="field-group"><button class="btn danger" @click="deleteSection(selectedSection.id)"><iconify-icon class="icon" icon="ph:trash"></iconify-icon>删除此区块</button></div>
                </template>
              </div>
            </aside>
          </div>

          <section v-else-if="currentView === 'products'" class="management">
            <div class="management-header"><div><h1>商品管理</h1><p>集中管理商品资料，并立即用于页面中的商品区块。</p></div><div class="management-actions"><button class="btn" @click="switchView('categories')"><iconify-icon class="icon" icon="ph:tree-structure"></iconify-icon>分类</button><button class="btn primary" @click="addProduct"><iconify-icon class="icon" icon="ph:plus"></iconify-icon>新建商品</button></div></div>
            <div class="stats-grid"><div class="stat-card"><div class="stat-label"><iconify-icon class="icon" icon="ph:handbag"></iconify-icon>商品总数</div><div class="stat-value">{{ cfg.products.length }}</div></div><div class="stat-card"><div class="stat-label"><iconify-icon class="icon" icon="ph:tree-structure"></iconify-icon>商品分类</div><div class="stat-value">{{ cfg.categories.length }}</div></div><div class="stat-card"><div class="stat-label"><iconify-icon class="icon" icon="ph:image"></iconify-icon>首屏画面</div><div class="stat-value">{{ cfg.heroes.length }}</div></div><div class="stat-card"><div class="stat-label"><iconify-icon class="icon" icon="ph:clock-counter-clockwise"></iconify-icon>待保存</div><div class="stat-value">{{ isDirty ? '1' : '0' }}</div></div></div>
            <div class="data-card"><div class="data-toolbar"><div class="search-wrap"><iconify-icon class="icon" icon="ph:magnifying-glass"></iconify-icon><input v-model="productQuery" class="search-input" type="search" placeholder="搜索名称或商品编号"></div><div class="filter-row"><select v-model="productCategory"><option value="all">全部分类</option><option v-for="cat in cfg.categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option></select></div></div>
              <div v-if="!filteredProducts.length" class="empty-state"><iconify-icon class="icon" icon="ph:package"></iconify-icon><h3>没有匹配的商品</h3><p>调整搜索条件，或创建一个新商品。</p><button class="btn" @click="productQuery='';productCategory='all'">清除筛选</button></div>
              <table v-else class="data-table"><thead><tr><th>商品</th><th>分类</th><th>价格</th><th>图片路径</th><th></th></tr></thead><tbody><tr v-for="product in filteredProducts" :key="product.id"><td><div class="product-cell"><img class="product-thumb" :src="mpUrl(product.img)" :alt="product.name"><div><div class="product-main">{{ product.name }}</div><div class="product-id">#{{ product.id }}</div></div></div></td><td><span class="badge">{{ categoryName(product.cat) }}</span></td><td>{{ money(product.price) }}</td><td class="product-id">{{ product.img }}</td><td><div class="row-actions"><button title="编辑" @click="editProduct(product)"><iconify-icon class="icon" icon="ph:pencil-simple"></iconify-icon></button><button title="删除" @click="removeProduct(product)"><iconify-icon class="icon" icon="ph:trash"></iconify-icon></button></div></td></tr></tbody></table>
              <div class="table-footer"><span>显示 {{ filteredProducts.length }} / {{ cfg.products.length }} 个商品</span><span>价格单位：人民币</span></div>
            </div>
          </section>

          <section v-else-if="currentView === 'categories'" class="management">
            <div class="management-header"><div><h1>分类管理</h1><p>编辑名称与排序，商品和页面筛选会自动使用这里的数据。</p></div><button class="btn primary" @click="cfg.categories.push({id:'cat-'+Date.now().toString(36),name:'新分类'})"><iconify-icon class="icon" icon="ph:plus"></iconify-icon>新建分类</button></div>
            <div class="data-card"><table class="data-table"><thead><tr><th>排序</th><th>分类名称</th><th>分类标识</th><th>商品数量</th><th></th></tr></thead><tbody><tr v-for="(cat,index) in cfg.categories" :key="cat.id"><td><div class="row-actions" style="justify-content:flex-start"><button :disabled="index===0" @click="[cfg.categories[index-1],cfg.categories[index]]=[cfg.categories[index],cfg.categories[index-1]]"><iconify-icon class="icon" icon="ph:arrow-up"></iconify-icon></button><button :disabled="index===cfg.categories.length-1" @click="[cfg.categories[index+1],cfg.categories[index]]=[cfg.categories[index],cfg.categories[index+1]]"><iconify-icon class="icon" icon="ph:arrow-down"></iconify-icon></button></div></td><td><div class="field" style="margin:0"><input v-model="cat.name" type="text"></div></td><td><span class="badge">{{ cat.id }}</span></td><td>{{ cfg.products.filter(p => p.cat === cat.id).length }}</td><td><div class="row-actions"><button title="删除分类" @click="removeCategory(cat)"><iconify-icon class="icon" icon="ph:trash"></iconify-icon></button></div></td></tr></tbody></table><div class="table-footer"><span>点击删除可查看分类的关联内容；处理完成后即可删除。</span><span>{{ cfg.categories.length }} 个分类</span></div></div>
          </section>

          <section v-else-if="currentView === 'media'" class="management">
            <div class="management-header"><div><h1>媒体库</h1><p>统一管理轮播图片、视频和商品素材，可直接用于页面区块。</p></div><div class="management-actions"><button class="btn" @click="loadMedia"><iconify-icon class="icon" icon="ph:arrows-clockwise"></iconify-icon>刷新</button><label class="btn primary"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon>上传媒体<input type="file" accept="image/*,video/*" multiple hidden @change="uploadFiles($event.target.files);$event.target.value=''" /></label></div></div>
             <div class="data-card"><div class="data-toolbar"><div class="search-wrap"><iconify-icon class="icon" icon="ph:magnifying-glass"></iconify-icon><input v-model="mediaQuery" class="search-input" type="search" placeholder="搜索文件名"></div><div class="media-toolbar-actions"><span class="crumb">{{ mediaSelectionMode ? '已选择 ' + selectedMediaCount + ' 个' : filteredMedia.length + ' 个文件' }}</span><select v-if="mediaSelectionMode && selectedMediaCount" v-model="mediaMoveTarget" class="media-move-select" aria-label="移动到文件夹"><option value="">移到全部素材</option><option v-for="folder in mediaFolders" :key="folder.id" :value="folder.id">移到 {{ folder.name }}</option></select><button v-if="mediaSelectionMode && selectedMediaCount" type="button" class="btn subtle" @click="moveSelectedMedia()"><iconify-icon class="icon" icon="ph:folder-notch-open"></iconify-icon>移动</button><button v-if="mediaSelectionMode" type="button" class="btn subtle" @click="toggleAllFilteredMedia">{{ allFilteredMediaSelected ? '取消当前全选' : '选择当前结果' }}</button><button v-if="mediaSelectionMode" type="button" class="btn danger" :disabled="!selectedMediaCount || mediaDeleting" @click="deleteSelectedMedia"><iconify-icon class="icon" :icon="mediaDeleting ? 'ph:spinner-gap' : 'ph:trash'"></iconify-icon>{{ mediaDeleting ? '正在删除' : '删除所选 (' + selectedMediaCount + ')' }}</button><button type="button" class="btn" :class="{primary:mediaSelectionMode}" @click="toggleMediaSelectionMode"><iconify-icon class="icon" :icon="mediaSelectionMode ? 'ph:check' : 'ph:checks'"></iconify-icon>{{ mediaSelectionMode ? '完成' : '批量管理' }}</button></div></div><div class="media-folder-row"><div class="media-folder-list"><button type="button" class="media-folder-pill" :class="{active:!mediaFolderId}" @click="mediaFolderId=''">全部素材 <span>{{ media.length }}</span></button><button v-for="folder in mediaFolders" :key="folder.id" type="button" class="media-folder-pill" :class="{active:mediaFolderId===folder.id}" @click="mediaFolderId=folder.id">{{ folder.name }} <span>{{ folder.count }}</span></button></div><div class="media-folder-actions"><button type="button" class="btn small" @click="createMediaFolder"><iconify-icon class="icon" icon="ph:folder-plus"></iconify-icon>新建文件夹</button><button v-if="mediaFolderId" type="button" class="icon-btn small" title="重命名文件夹" @click="renameMediaFolder(mediaFolders.find(folder => folder.id === mediaFolderId))"><iconify-icon class="icon" icon="ph:pencil-simple"></iconify-icon></button><button v-if="mediaFolderId" type="button" class="icon-btn small danger" title="删除文件夹" @click="deleteMediaFolder(mediaFolders.find(folder => folder.id === mediaFolderId))"><iconify-icon class="icon" icon="ph:trash"></iconify-icon></button></div></div>
              <div v-if="mediaLoading" class="skeleton-grid"><div v-for="n in 8" :key="n" class="skeleton"></div></div>
              <div v-else-if="mediaError" class="empty-state"><iconify-icon class="icon" icon="ph:warning-circle"></iconify-icon><h3>媒体库加载失败</h3><p>{{ mediaError }}</p><button class="btn" @click="loadMedia">重试</button></div>
              <div v-else-if="!filteredMedia.length" class="empty-state"><iconify-icon class="icon" icon="ph:image-square"></iconify-icon><h3>没有找到媒体</h3><p>上传 JPG、PNG、WebP、MP4 或 WebM 文件。</p></div>
               <div v-else class="media-grid"><article v-for="item in filteredMedia" :key="item.name" class="media-card" :class="{selected:isMediaSelected(item) || selectedMedia?.name===item.name}" tabindex="0" :aria-label="'素材 ' + item.name" @click="selectMedia(item)" @keydown.enter.prevent="selectMedia(item)" @keydown.space.prevent="selectMedia(item)"><div class="media-image"><video v-if="item.kind==='video'" :src="item.path" muted preload="metadata"></video><img v-else :src="item.path" :alt="item.name"><span class="media-kind-badge" :title="'素材类型：' + mediaKindLabel(item)"><iconify-icon class="icon" :icon="item.kind==='video' ? 'ph:video-camera' : 'ph:image'"></iconify-icon>{{ mediaKindLabel(item) }}</span></div><div class="media-meta"><div class="media-name">{{ item.name }}</div><div class="media-size">{{ item.sizeKB }} KB · {{ item.mpPath }}</div></div><span v-if="mediaSelectionMode && (isMediaSelected(item) || selectedMedia?.name === item.name)" class="media-check" aria-hidden="true"><iconify-icon class="icon" icon="ph:check"></iconify-icon></span><button v-if="!mediaSelectionMode && selectedMedia?.name === item.name" type="button" class="media-delete-btn" :aria-label="'删除素材 ' + item.name" title="删除素材" :disabled="mediaDeleting" @click.stop="deleteMediaItem(item)"><iconify-icon class="icon" icon="ph:trash"></iconify-icon></button></article></div>
            </div>
          </section>

          <section v-else-if="currentView === 'theme'" class="management">
            <div class="management-header"><div><h1>主题设置</h1><p>选择预设或精细调整颜色，画布会实时反映效果。</p></div><button class="btn" @click="switchView('editor')"><iconify-icon class="icon" icon="ph:eye"></iconify-icon>返回预览</button></div>
            <div class="theme-layout"><div class="theme-card"><h2>主题预设</h2><p>预设会替换整套颜色，仍可在右侧继续微调。</p><div class="preset-grid"><button v-for="(preset,key) in cfg.themePresets" :key="key" class="preset-card" :class="{active:cfg.theme.preset===key}" @click="applyPreset(key,preset)"><div class="preset-swatch" :style="{background:preset.colors.bgPrimary}"><span :style="{background:preset.colors.bgSecondary}"></span><span :style="{background:preset.colors.textPrimary}"></span><span :style="{background:preset.colors.accent}"></span></div><div class="preset-name">{{ preset.name }}</div></button></div></div>
              <div class="theme-card"><h2>颜色系统</h2><p>调整后会应用到管理预览和同步生成的小程序样式。</p><div class="theme-fields"><div v-for="(label,key) in {bgPrimary:'主背景',bgSecondary:'次背景',bgTertiary:'三级背景',textPrimary:'主文字',textSecondary:'次文字',accent:'强调色',border:'边框'}" :key="key" class="field"><label>{{ label }}</label><div class="color-field"><input v-model="cfg.theme.colors[key]" type="color"><input v-model="cfg.theme.colors[key]" type="text"></div></div></div></div></div>
          </section>

          <section v-else class="management">
            <div class="management-header"><div><h1>全局设置</h1><p>维护品牌资料、底部导航与同步信息。</p></div></div>
            <div class="theme-layout"><div class="theme-card"><h2>品牌资料</h2><p>这些内容会被页面区块和小程序生成文件复用。</p><div class="field"><label>品牌名称</label><input v-model="cfg.brand.name" type="text"></div><div class="field"><label>会员标语</label><textarea v-model="cfg.brand.slogan"></textarea></div><div class="field"><label>顾问文案</label><textarea v-model="cfg.brand.advisorslogan"></textarea></div></div><div class="theme-card"><h2>项目状态</h2><p>保存只写入配置；同步会进一步更新小程序源文件。</p><div class="field-group"><div class="toggle-row"><span>配置状态</span><span class="badge">{{ isDirty ? '待保存' : '已保存' }}</span></div><div class="toggle-row"><span>最近同步</span><span>{{ cfg._lastSync ? new Date(cfg._lastSync).toLocaleString('zh-CN') : '尚未同步' }}</span></div></div><button class="btn primary" @click="syncProject"><iconify-icon class="icon" icon="ph:arrows-clockwise"></iconify-icon>保存并同步</button></div></div>
            <section class="theme-card service-settings-card"><div class="settings-card-header"><div><h2>智能客服</h2><p>设置全站客服入口、对话欢迎语和快捷问题。飞书密钥只在微信云环境中维护。</p></div><span class="badge">规则问答</span></div>
              <div class="service-settings-grid">
                <div class="service-settings-main"><div class="toggle-row"><span>显示客服入口</span><button type="button" class="switch" :class="{on:cfg.serviceBot.enabled}" role="switch" :aria-checked="cfg.serviceBot.enabled" @click="cfg.serviceBot.enabled=!cfg.serviceBot.enabled"></button></div><div class="field"><label>欢迎语</label><textarea v-model="cfg.serviceBot.welcomeMessage" maxlength="160"></textarea></div><div class="field"><label>快捷问题</label><div class="service-prompt-editor"><input v-for="(prompt,index) in cfg.serviceBot.quickPrompts" :key="index" v-model="cfg.serviceBot.quickPrompts[index]" type="text" maxlength="32" :aria-label="'快捷问题 ' + (index + 1)"></div></div></div>
                <div class="service-settings-side"><div class="field"><label>客服图标</label><div class="service-icon-control"><button type="button" class="service-icon-preview" @click="openServiceBotMediaPicker"><img :src="mpUrl(cfg.serviceBot.icon)" alt="当前客服图标"><span>从媒体库更换</span></button><label class="icon-upload-btn" title="上传客服图标"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon><input type="file" accept="image/*" hidden @change="uploadServiceBotIcon($event.target.files);$event.target.value=''" /></label></div></div><div class="service-number-grid"><div class="field"><label>尺寸（rpx）</label><input v-model.number="cfg.serviceBot.size" type="number" min="64" max="120"></div><div class="field"><label>右侧距离</label><input v-model.number="cfg.serviceBot.right" type="number" min="8" max="300"></div><div class="field"><label>底部距离</label><input v-model.number="cfg.serviceBot.bottom" type="number" min="112" max="700"></div></div><div class="field"><label>身份验证</label><select v-model="cfg.serviceBot.authMode"><option value="test">测试验证码</option><option value="wechat">微信手机号授权</option></select></div><div class="toggle-row"><span>微信人工客服已开通</span><button type="button" class="switch" :class="{on:cfg.serviceBot.humanServiceEnabled}" role="switch" :aria-checked="cfg.serviceBot.humanServiceEnabled" @click="cfg.serviceBot.humanServiceEnabled=!cfg.serviceBot.humanServiceEnabled"></button></div></div>
              </div>
              <div class="service-status-row"><span><i class="ok"></i>回答引擎：规则匹配</span><span><i :class="cfg.serviceBot.authMode==='test' ? 'warn' : 'ok'"></i>{{ cfg.serviceBot.authMode==='test' ? '测试身份模式' : '微信手机号模式' }}</span><span><i :class="cfg.serviceBot.humanServiceEnabled ? 'ok' : 'warn'"></i>{{ cfg.serviceBot.humanServiceEnabled ? '人工客服已启用' : '人工客服待开通' }}</span></div>
            </section>
            <section class="theme-card tabbar-settings-card"><div class="settings-card-header"><div><h2>底部导航</h2><p>为五个导航项配置图标与文字。每张图片均可独立调整取景、从媒体库更换或直接上传。</p></div><span class="badge">9 个图片槽位</span></div>
              <div class="tabbar-settings-list">
                <article v-for="(item,index) in cfg.tabBar.items" :key="index" class="tabbar-setting-row" :class="{center:item.center}">
                  <div class="tabbar-setting-title"><span class="tabbar-setting-index">{{ index + 1 }}</span><div><strong>{{ item.text }}</strong><small>{{ item.center ? '中间主按钮' : '底部导航项' }}</small></div></div>
                  <div class="tabbar-setting-fields">
                    <div class="field"><label>显示文字</label><input v-model="item.text" type="text" maxlength="12"></div>
                    <template v-if="!item.center">
                      <div class="tabbar-icon-field"><label>默认图标</label><div class="tabbar-icon-control"><button type="button" class="tabbar-icon-preview" @click="openTabBarCrop(index,'icon')"><img :src="mpUrl(item.icon)" :alt="item.text + ' 默认图标'"><span>调整取景</span></button><button type="button" class="icon-upload-btn" title="从媒体库更换默认图标" :aria-label="item.text + ' 从媒体库更换默认图标'" @click="openTabBarMediaPicker(index,'icon')"><iconify-icon class="icon" icon="ph:images"></iconify-icon></button><label class="icon-upload-btn" title="上传默认图标"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon><input type="file" accept="image/*" hidden @change="uploadTabBarIcon($event.target.files,index,'icon');$event.target.value=''" /></label></div></div>
                      <div class="tabbar-icon-field"><label>选中图标</label><div class="tabbar-icon-control"><button type="button" class="tabbar-icon-preview" @click="openTabBarCrop(index,'iconOn')"><img :src="mpUrl(item.iconOn)" :alt="item.text + ' 选中图标'"><span>调整取景</span></button><button type="button" class="icon-upload-btn" title="从媒体库更换选中图标" :aria-label="item.text + ' 从媒体库更换选中图标'" @click="openTabBarMediaPicker(index,'iconOn')"><iconify-icon class="icon" icon="ph:images"></iconify-icon></button><label class="icon-upload-btn" title="上传选中图标"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon><input type="file" accept="image/*" hidden @change="uploadTabBarIcon($event.target.files,index,'iconOn');$event.target.value=''" /></label></div></div>
                    </template>
                    <template v-else>
                      <div class="tabbar-icon-field"><label>主按钮图片</label><div class="tabbar-icon-control"><button type="button" class="tabbar-icon-preview center" @click="openTabBarCrop(index,'centerIcon')"><img :src="mpUrl(item.centerIcon)" alt="中间主按钮图片"><span>{{ isAnimatedImage(item.centerIcon) ? '动态 GIF' : '调整取景' }}</span></button><button type="button" class="icon-upload-btn" title="从媒体库更换主按钮图片" aria-label="从媒体库更换主按钮图片" @click="openTabBarMediaPicker(index,'centerIcon')"><iconify-icon class="icon" icon="ph:images"></iconify-icon></button><label class="icon-upload-btn" title="上传主按钮图片"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon><input type="file" accept="image/*" hidden @change="uploadTabBarIcon($event.target.files,index,'centerIcon');$event.target.value=''" /></label></div></div>
                      <div class="field"><label>图标尺寸（rpx）</label><input v-model.number="cfg.tabBar.centerSize" type="number" min="72" max="140" step="2"></div>
                      <div class="field"><label>上浮高度（rpx）</label><input v-model.number="cfg.tabBar.centerLift" type="number" min="0" max="90" step="2"></div>
                    </template>
                  </div>
                </article>
              </div>
              <p class="tabbar-settings-note"><iconify-icon class="icon" icon="ph:info"></iconify-icon>静态图片支持拖动取景并生成 512 × 512 WebP；中间主按钮也可使用小于 1.2 MB 的 GIF，动画会完整保留且不能裁切。保存后点击“同步小程序”才会写入微信小程序。</p>
            </section>
          </section>
        </main>
      </div>

      <template v-if="mediaPickerOpen">
        <div class="drawer-backdrop" @click="mediaPickerOpen=false"></div>
        <aside class="media-picker-sheet">
          <div class="drawer-header"><div><h2>{{ mediaPickerMode==='replace' ? '替换轮播媒体' : mediaPickerMode==='product' ? '选择商品图片' : mediaPickerMode==='section-media' ? '选择背景媒体' : mediaPickerMode==='tabbar' ? '选择导航图标' : mediaPickerMode==='servicebot' ? '选择客服图标' : '添加轮播媒体' }}</h2><p>{{ mediaPickerMode==='product' ? '选择一张图片用于商品主图或详情图。' : mediaPickerMode==='section-media' ? '选择图片或视频作为当前区块背景。' : mediaPickerMode==='tabbar' ? '仅显示图片素材，可用于默认、选中或中间主按钮图标。' : mediaPickerMode==='servicebot' ? '选择一张图片作为全站智能客服入口。' : '选择已有素材，或从本地直接上传图片与视频。' }}</p></div><button class="icon-btn" @click="mediaPickerOpen=false"><iconify-icon class="icon" icon="ph:x"></iconify-icon></button></div>
          <div class="media-picker-toolbar"><div class="search-wrap"><iconify-icon class="icon" icon="ph:magnifying-glass"></iconify-icon><input v-model="mediaQuery" class="search-input" type="search" placeholder="搜索媒体文件"></div><select v-if="mediaFolders.length" v-model="mediaFolderId" class="media-folder-select" aria-label="选择媒体文件夹"><option value="">全部文件夹</option><option v-for="folder in mediaFolders" :key="folder.id" :value="folder.id">{{ folder.name }}</option></select><label class="btn primary"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon>{{ mediaPickerMode==='product' ? '上传并使用图片' : mediaPickerMode==='tabbar' || mediaPickerMode==='servicebot' ? '上传并使用图标' : '上传并使用' }}<input type="file" :accept="['product','tabbar','servicebot'].includes(mediaPickerMode) ? 'image/*' : 'image/*,video/*'" :multiple="!['tabbar','servicebot'].includes(mediaPickerMode)" hidden @change="mediaPickerMode==='product' ? uploadProductImages($event.target.files, productMediaTarget) : mediaPickerMode==='section-media' ? uploadSectionMedia($event.target.files) : mediaPickerMode==='tabbar' ? uploadTabBarIcon($event.target.files, tabBarMediaTarget.index, tabBarMediaTarget.field) : mediaPickerMode==='servicebot' ? uploadServiceBotIcon($event.target.files) : uploadFiles($event.target.files,true);$event.target.value=''" /></label></div>
          <div v-if="mediaLoading" class="skeleton-grid"><div v-for="n in 8" :key="n" class="skeleton"></div></div>
          <div v-else-if="mediaError" class="empty-state"><iconify-icon class="icon" icon="ph:warning-circle"></iconify-icon><h3>媒体库暂时不可用</h3><p>{{ mediaError }}</p><button class="btn" @click="loadMedia">重试</button></div>
          <div v-else-if="!mediaPickerItems.length" class="empty-state"><iconify-icon class="icon" icon="ph:image-square"></iconify-icon><h3>{{ mediaPickerMode==='tabbar' ? '还没有可用图片' : '还没有可用素材' }}</h3><p>{{ mediaPickerMode==='product' ? '上传一张商品图片，马上用于当前商品。' : mediaPickerMode==='section-media' ? '上传图片或视频，马上作为区块背景。' : mediaPickerMode==='tabbar' ? '上传一张图片，马上作为导航图标。' : '上传首张图片或视频，马上加入轮播。' }}</p></div>
          <div v-else class="media-picker-grid"><button v-for="item in mediaPickerItems" :key="item.name" class="media-picker-card" @click="addMediaToHero(item)"><video v-if="item.kind==='video'" :src="item.path" muted preload="metadata"></video><img v-else :src="item.path" :alt="item.name"><span class="media-kind-badge" :title="'素材类型：' + mediaKindLabel(item)"><iconify-icon class="icon" :icon="item.kind==='video' ? 'ph:video-camera' : 'ph:image'"></iconify-icon>{{ mediaKindLabel(item) }}</span><span class="media-picker-name">{{ item.name }}</span></button></div>
        </aside>
      </template>

      <template v-if="tabBarCrop.open">
        <div class="drawer-backdrop crop-backdrop" @click="closeTabBarCrop"></div>
        <section class="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="tabbar-crop-title">
          <div class="crop-dialog-header">
            <div><h2 id="tabbar-crop-title">调整图片取景</h2><p>{{ tabBarCropTitle() }}</p></div>
            <button type="button" class="icon-btn" title="关闭取景" aria-label="关闭取景" :disabled="tabBarCrop.applying" @click="closeTabBarCrop"><iconify-icon class="icon" icon="ph:x"></iconify-icon></button>
          </div>
          <div class="crop-dialog-body">
            <div class="crop-editor-column">
              <div
                class="crop-viewport" :class="{circle:tabBarCrop.field==='centerIcon',loading:tabBarCrop.loading}"
                tabindex="0" role="img" aria-label="图片取景区域，可拖动图片或使用方向键调整"
                @pointerdown="beginTabBarCropDrag" @pointermove="moveTabBarCropDrag" @pointerup="endTabBarCropDrag" @pointercancel="endTabBarCropDrag" @keydown="handleTabBarCropKey"
              >
                <canvas ref="tabBarCropCanvas" width="512" height="512"></canvas>
                <div class="crop-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
                <div v-if="tabBarCrop.loading" class="crop-loading"><iconify-icon class="icon" icon="ph:spinner-gap"></iconify-icon><span>正在读取图片</span></div>
              </div>
              <p class="crop-help">拖动图片调整位置，方向键可微调，按住 Shift 可加速。</p>
            </div>
            <aside class="crop-preview-column">
              <span class="crop-preview-label">最终效果</span>
              <div class="crop-final-preview" :class="{circle:tabBarCrop.field==='centerIcon'}"><canvas ref="tabBarCropPreviewCanvas" width="512" height="512"></canvas></div>
              <strong>{{ tabBarCrop.field === 'centerIcon' ? '圆形主按钮' : '方形导航图标' }}</strong>
              <span>输出 512 × 512 WebP</span>
              <p v-if="tabBarCrop.isGif" class="crop-gif-note"><iconify-icon class="icon" icon="ph:info"></iconify-icon>动态 GIF 会完整保留，不能进行取景裁切；如需裁切请先更换为静态图片。</p>
            </aside>
          </div>
          <div class="crop-controls">
            <div class="crop-zoom-control"><label for="tabbar-crop-zoom">缩放</label><input id="tabbar-crop-zoom" :value="tabBarCrop.zoom" type="range" min="1" max="3" step="0.01" @input="updateTabBarCropZoom($event.target.value)"><output>{{ Math.round(tabBarCrop.zoom * 100) }}%</output></div>
            <button type="button" class="btn" :disabled="tabBarCrop.loading || tabBarCrop.applying" @click="resetTabBarCrop"><iconify-icon class="icon" icon="ph:arrow-counter-clockwise"></iconify-icon>重置取景</button>
          </div>
          <div v-if="tabBarCrop.error" class="crop-error" role="alert"><iconify-icon class="icon" icon="ph:warning-circle"></iconify-icon><span>{{ tabBarCrop.error }}</span></div>
          <div class="crop-dialog-footer">
            <button type="button" class="btn" :disabled="tabBarCrop.applying" @click="closeTabBarCrop">取消</button>
            <button type="button" class="btn primary" :disabled="tabBarCrop.loading || tabBarCrop.applying || !!tabBarCrop.error" @click="applyTabBarCrop"><iconify-icon class="icon" :icon="tabBarCrop.applying ? 'ph:spinner-gap' : 'ph:check'"></iconify-icon>{{ tabBarCrop.applying ? '正在生成' : '应用取景' }}</button>
          </div>
        </section>
      </template>

      <template v-if="newPage.open">
        <div class="drawer-backdrop" @click="newPage.open=false"></div>
        <form class="new-page-dialog" @submit.prevent="createBlankPage">
          <div class="drawer-header"><div><h2>新建空白页面</h2><p>从一张空画布开始，再自由添加轮播、文字、商品等区块。</p></div><button type="button" class="icon-btn" @click="newPage.open=false"><iconify-icon class="icon" icon="ph:x"></iconify-icon></button></div>
          <div class="new-page-body">
            <div class="new-page-symbol"><iconify-icon class="icon" icon="ph:file-plus"></iconify-icon></div>
            <div class="field"><label for="new-page-name">页面名称</label><input id="new-page-name" v-model="newPage.name" type="text" maxlength="24" placeholder="例如：品牌故事" @input="newPage.error=''" /></div>
            <div class="field"><label for="new-page-slug">页面地址（可选）</label><div class="page-path-input"><span>/pages/custom-</span><input id="new-page-slug" v-model="newPage.slug" type="text" placeholder="brand-story" /></div><small>只使用英文、数字和短横线；留空时会自动生成。</small></div>
            <div v-if="newPage.error" class="form-error"><iconify-icon class="icon" icon="ph:warning-circle"></iconify-icon>{{ newPage.error }}</div>
            <div class="new-page-note"><iconify-icon class="icon" icon="ph:info"></iconify-icon><span>创建后页面会立即出现在编辑器和所有“跳转目标”选项中。保存并同步后，才会写入小程序。</span></div>
          </div>
          <div class="drawer-footer"><button type="button" class="btn subtle" @click="newPage.open=false">取消</button><button type="submit" class="btn primary"><iconify-icon class="icon" icon="ph:plus"></iconify-icon>创建并开始编辑</button></div>
        </form>
      </template>

      <template v-if="homeNavOpen">
        <div class="drawer-backdrop" @click="finishHomeNavigation"></div>
        <aside class="drawer home-nav-drawer">
          <div class="drawer-header"><div><h2>首页导航</h2><p>管理首页顶部的频道名称和顺序。</p></div><button class="icon-btn" @click="finishHomeNavigation"><iconify-icon class="icon" icon="ph:x"></iconify-icon></button></div>
          <div class="drawer-body"><div class="home-nav-preview"><span v-for="(channel,index) in cfg.homeChannels" :key="channel+index" :class="{active:index===0}">{{ channel || '未命名' }}</span></div><div class="home-nav-list"><div v-for="(channel,index) in cfg.homeChannels" :key="index" class="home-nav-row"><span class="home-nav-index">{{ index + 1 }}</span><input v-model="cfg.homeChannels[index]" type="text" maxlength="18" placeholder="频道名称"><div class="row-actions"><button title="前移" :disabled="index===0" @click="moveHomeChannel(index,-1)"><iconify-icon class="icon" icon="ph:arrow-up"></iconify-icon></button><button title="后移" :disabled="index===cfg.homeChannels.length-1" @click="moveHomeChannel(index,1)"><iconify-icon class="icon" icon="ph:arrow-down"></iconify-icon></button><button title="删除频道" @click="removeHomeChannel(index)"><iconify-icon class="icon" icon="ph:trash"></iconify-icon></button></div></div></div><button class="btn add-channel" :disabled="cfg.homeChannels.length>=5" @click="addHomeChannel"><iconify-icon class="icon" icon="ph:plus"></iconify-icon>添加频道</button><p class="home-nav-note">第一个频道会作为默认选中项。最多 5 个频道，保存并同步后会更新小程序首页。</p></div>
          <div class="drawer-footer"><button class="btn subtle" @click="finishHomeNavigation">完成</button><button class="btn primary" @click="finishHomeNavigation"><iconify-icon class="icon" icon="ph:check"></iconify-icon>应用导航设置</button></div>
        </aside>
      </template>

      <template v-if="editingProduct">
        <div class="drawer-backdrop" @click="editingProduct=null"></div>
        <aside class="drawer">
          <div class="drawer-header"><h2>{{ cfg.products.some(p=>p.id===editingProduct.id) ? '编辑商品' : '新建商品' }}</h2><button class="icon-btn" @click="editingProduct=null"><iconify-icon class="icon" icon="ph:x"></iconify-icon></button></div>
          <div class="drawer-body"><div class="field-group product-media-group"><div class="field-title">商品图片 <span class="field-hint">{{ productImages(editingProduct).length }}/5 张主图</span></div><div class="product-gallery-grid"><button v-for="slot in 5" :key="slot" type="button" class="product-gallery-slot" :class="{filled:productImages(editingProduct)[slot-1]}" @click="openProductMediaPicker(productImages(editingProduct)[slot-1] ? slot-1 : null, 'gallery')"><img v-if="productImages(editingProduct)[slot-1]" :src="mpUrl(productImages(editingProduct)[slot-1])" :alt="editingProduct.name + ' 主图 ' + slot"><iconify-icon v-else class="icon" icon="ph:plus"></iconify-icon><span>{{ slot === 1 ? '封面' : '主图 ' + slot }}</span><i v-if="productImages(editingProduct)[slot-1]" class="product-gallery-remove" title="删除主图" @click.stop="removeProductImage(slot-1)"><iconify-icon class="icon" icon="ph:x"></iconify-icon></i></button></div><div class="product-media-actions"><button class="btn small" type="button" @click="openProductMediaPicker(null, 'gallery')"><iconify-icon class="icon" icon="ph:images"></iconify-icon>从媒体库选择</button><label class="btn small"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon>上传主图<input type="file" accept="image/*" multiple hidden @change="uploadProductImages($event.target.files,'gallery');$event.target.value=''" /></label></div><p class="product-editor-note">第一张作为商品封面，最多 5 张。点击已有图片可替换。</p></div><div class="field"><label>商品名称</label><input v-model="editingProduct.name" type="text"></div><div class="field"><label>商品编号</label><input v-model.number="editingProduct.id" type="number" disabled></div><div class="field"><label>所属分类</label><select v-model="editingProduct.cat"><option v-for="cat in cfg.categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option></select></div><div class="field"><label>价格（元）</label><input v-model.number="editingProduct.price" type="number" min="0"></div><div class="field"><label>简短描述</label><textarea v-model="editingProduct.description" placeholder="用于商品详情页首段"></textarea></div><div class="field-group"><div class="field-title">颜色</div><div v-for="(color,index) in editingProduct.colors" :key="index" class="product-option-row"><input v-model="color.name" type="text" placeholder="颜色名称"><div class="color-field"><input v-model="color.value" type="color"><input v-model="color.value" type="text"></div><button class="icon-btn small" type="button" title="删除颜色" @click="removeProductColor(index)"><iconify-icon class="icon" icon="ph:trash"></iconify-icon></button></div><button class="btn small" type="button" @click="addProductColor"><iconify-icon class="icon" icon="ph:plus"></iconify-icon>添加颜色</button></div><div class="field-group"><div class="field-title">尺码</div><div class="product-chip-editor"><div v-for="(size,index) in editingProduct.sizes" :key="index" class="product-chip-row"><input v-model="editingProduct.sizes[index]" type="text" placeholder="如 S / M / L"><button class="icon-btn small" type="button" title="删除尺码" @click="removeProductSize(index)"><iconify-icon class="icon" icon="ph:trash"></iconify-icon></button></div></div><button class="btn small" type="button" @click="addProductSize"><iconify-icon class="icon" icon="ph:plus"></iconify-icon>添加尺码</button></div><div class="field-group"><div class="field-title">详情页内容</div><div class="field"><label>商品详情说明</label><textarea v-model="editingProduct.detail" placeholder="材质、工艺、护理与设计细节"></textarea></div><div class="field-title">详情图片 <span class="field-hint">{{ editingProduct.detailImages.length }}/12 张</span></div><div class="detail-image-list"><div v-for="(image,index) in editingProduct.detailImages" :key="image" class="detail-image-item"><img :src="mpUrl(image)" :alt="editingProduct.name + ' 详情图'"><button class="icon-btn small" type="button" title="删除详情图" @click="removeProductDetailImage(index)"><iconify-icon class="icon" icon="ph:x"></iconify-icon></button></div></div><div class="product-media-actions"><button class="btn small" type="button" @click="openProductMediaPicker(null, 'detail')"><iconify-icon class="icon" icon="ph:images"></iconify-icon>从媒体库选择</button><label class="btn small"><iconify-icon class="icon" icon="ph:upload-simple"></iconify-icon>上传详情图<input type="file" accept="image/*" multiple hidden @change="uploadProductImages($event.target.files,'detail');$event.target.value=''" /></label></div></div></div>
          <div class="drawer-footer"><button class="btn subtle" @click="editingProduct=null">取消</button><button class="btn primary" @click="saveProduct">保存商品</button></div>
        </aside>
      </template>

      <template v-if="previewDialog.open">
        <div class="drawer-backdrop" @click="closePhonePreview"></div>
        <section class="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="phone-preview-title">
          <div class="drawer-header"><div><h2 id="phone-preview-title">手机扫码预览</h2><p>将当前设计同步到小程序后，使用微信扫一扫预览。</p></div><button class="icon-btn" type="button" title="关闭" @click="closePhonePreview"><iconify-icon class="icon" icon="ph:x"></iconify-icon></button></div>
          <div class="preview-dialog-body">
            <div v-if="previewDialog.state === 'syncing' || previewDialog.state === 'generating'" class="preview-progress"><iconify-icon class="icon" icon="ph:circle-notch"></iconify-icon><h3>{{ previewDialog.state === 'syncing' ? '正在同步当前设计' : '正在生成微信预览码' }}</h3><p>{{ previewDialog.state === 'syncing' ? '请稍候，确保手机看到的是最新内容。' : '微信开发者工具正在创建可扫码的预览二维码。' }}</p></div>
            <div v-else-if="previewDialog.state === 'ready'" class="preview-qr"><img :src="previewDialog.qrUrl" alt="微信小程序预览二维码"><h3>使用微信扫一扫</h3><p>二维码失效或修改设计后，点击“重新生成”即可获取新的预览码。</p></div>
            <div v-else class="preview-progress error"><iconify-icon class="icon" icon="ph:warning-circle"></iconify-icon><h3>未能生成预览二维码</h3><p>{{ previewDialog.error }}</p></div>
          </div>
          <div class="drawer-footer"><button class="btn subtle" type="button" @click="closePhonePreview">关闭</button><button class="btn primary" type="button" :disabled="previewDialog.state === 'syncing' || previewDialog.state === 'generating'" @click="openPhonePreview"><iconify-icon class="icon" icon="ph:arrows-clockwise"></iconify-icon>{{ previewDialog.state === 'ready' ? '重新生成' : '重试生成' }}</button></div>
        </section>
      </template>

      <div class="toast-stack" aria-live="polite"><div v-for="item in toasts" :key="item.id" class="toast" :class="item.type"><iconify-icon class="icon" :icon="item.type === 'error' ? 'ph:warning-circle' : 'ph:check-circle'"></iconify-icon><div class="toast-copy"><div class="toast-title">{{ item.title }}</div><div v-if="item.message" class="toast-message">{{ item.message }}</div></div></div></div>
    </div>
  `
}).mount("#app");
