const fs = require("fs");
const path = require("path");

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cssValue(value) {
  return String(value ?? "").replace(/[{}<>]/g, "").replace(/;/g, "");
}

function spacingValue(value, fallback = 0, max = 240) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(0, number)) : fallback;
}

function productGallery(product = {}) {
  return [...(Array.isArray(product.gallery) ? product.gallery : []), product.img]
    .filter((path, index, list) => path && list.indexOf(path) === index)
    .slice(0, 5);
}

function normalizeHotspots(hotspots = []) {
  return (Array.isArray(hotspots) ? hotspots : []).map((hotspot, index) => {
    const width = Math.min(100, Math.max(4, Number(hotspot.width || 30)));
    const height = Math.min(100, Math.max(4, Number(hotspot.height || 18)));
    return {
      id: hotspot.id || `hotspot-${index}`,
      label: hotspot.label || `热区 ${index + 1}`,
      x: Math.min(100 - width, Math.max(0, Number(hotspot.x || 0))),
      y: Math.min(100 - height, Math.max(0, Number(hotspot.y || 0))),
      width, height,
      linkType: hotspot.linkType || "page",
      linkValue: hotspot.linkValue || "/pages/category/category"
    };
  });
}

const FONT_STACKS = {
  system: '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
  "luxury-serif": '"Songti SC","STSong","Noto Serif SC",serif',
  "clean-sans": '"PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif',
  editorial: 'Didot,"Times New Roman","Songti SC",serif',
  geometric: 'Futura,Avenir,"PingFang SC",sans-serif',
  soft: 'Optima,"Noto Sans SC","PingFang SC",sans-serif'
};

function typographyTokens(cfg = {}) {
  return {
    caption: 22,
    meta: 24,
    body: 28,
    sectionTitle: 34,
    pageTitle: 42,
    heroTitle: 54,
    bodyLineHeight: 1.65,
    headingLineHeight: 1.3,
    ...(cfg.designSystem?.miniProgramTypography || {})
  };
}

function blockInlineStyle(style = {}, cfg) {
  const font = FONT_STACKS[style.fontFamily] || cfg.customFonts?.find(item => item.id === style.fontFamily)?.id || FONT_STACKS.system;
  const type = typographyTokens(cfg);
  return [
    `background:${cssValue(style.backgroundColor || cfg.theme.colors.bgPrimary)}`,
    `color:${cssValue(style.textColor || cfg.theme.colors.textPrimary)}`,
    `font-family:${cssValue(font)}`,
    `font-size:${Number(style.fontSize || type.body / 2) * 2}rpx`,
    `font-weight:${Number(style.fontWeight || 400)}`,
    `text-align:${cssValue(style.textAlign || "left")}`,
    `letter-spacing:${Number(style.letterSpacing || 0)}px`,
    `line-height:${Number(style.lineHeight || type.bodyLineHeight)}`,
    `padding:${spacingValue(style.paddingY)}px ${spacingValue(style.paddingX, 0, 120)}px`,
    `margin-top:${spacingValue(style.marginTop)}px`,
    `margin-bottom:${spacingValue(style.marginBottom)}px`,
    `border:${Number(style.borderWidth || 0)}px solid ${cssValue(style.borderColor || "transparent")}`,
    `border-radius:${Number(style.borderRadius || 0)}px`
  ].join(";");
}

function buttonInlineStyle(style = {}, cfg) {
  const type = typographyTokens(cfg);
  return `color:${cssValue(style.buttonTextColor || cfg.theme.colors.accent)};background:${cssValue(style.buttonBackground || "transparent")};border:${Number(style.buttonBorderWidth ?? 1)}px solid ${cssValue(style.buttonBorderColor || cfg.theme.colors.accent)};border-radius:${Number(style.buttonRadius || 0)}px;font-size:${Number(style.buttonFontSize || type.body / 2) * 2}rpx`;
}

function blockHotspotLayer(key) {
  return `<view wx:for="{{${key}Hotspots}}" wx:for-item="spot" wx:key="id" class="builder-hotspot" style="left:{{spot.x}}%;top:{{spot.y}}%;width:{{spot.width}}%;height:{{spot.height}}%" data-link-type="{{spot.linkType}}" data-link-value="{{spot.linkValue}}" catchtap="hotspotAction"></view>`;
}

function staticHotspotLayer(block) {
  return normalizeHotspots(block?.props?.hotspots).map(spot => `<view style="position:absolute;z-index:30;left:${spot.x}%;top:${spot.y}%;width:${spot.width}%;height:${spot.height}%;background:transparent" data-link-type="${escapeXml(spot.linkType)}" data-link-value="${escapeXml(spot.linkValue)}" catchtap="hotspotAction"></view>`).join("");
}

function syncHomeLayout(cfg, root, pageId = "home", pageMeta = {}) {
  if (pageId === "appointment") return syncAppointmentLayout(cfg, root, pageMeta);
  const colors = cfg.theme.colors;
  const type = typographyTokens(cfg);
  const blocks = (cfg.pageLayouts[pageId] || []).filter(block => block.enabled !== false && block.visibility?.mobile !== false);
  const pageDir = path.join(root, "pages", pageId);
  if (!fs.existsSync(pageDir)) return [];
  const tabIds = ["home", "category", "campaign", "cart", "mine"];
  const tabIndex = tabIds.indexOf(pageId);
  const categoryGridIndex = pageId === "category" ? blocks.findIndex(block => block.type === "product-grid") : -1;
  const productDetailIndex = blocks.findIndex(block => block.type === "product-detail");
  const productCatalog = (cfg.products || []).map(product => ({
    ...product,
    gallery: productGallery(product),
    colors: Array.isArray(product.colors) ? product.colors : [],
    sizes: Array.isArray(product.sizes) ? product.sizes : [],
    description: product.description || "",
    detailImages: Array.isArray(product.detailImages) ? product.detailImages : []
  }));
  const data = {
    navPadTop: 20,
    channels: cfg.homeChannels || ["推荐"],
    channel: (cfg.homeChannels || ["推荐"])[0],
    pageTitle: pageMeta.name || pageId,
    cartItems: [],
    cartSummary: { quantity: 0, price: 0 },
    serviceBot: {
      enabled: cfg.serviceBot?.enabled !== false,
      icon: cfg.serviceBot?.icon || "/images/icon-headset.png",
      size: Math.max(64, Math.min(120, Number(cfg.serviceBot?.size || 88))),
      right: Math.max(8, Math.min(300, Number(cfg.serviceBot?.right || 24))),
      bottom: Math.max(112, Math.min(700, Number(cfg.serviceBot?.bottom || 150)))
    }
  };
  data.activeCategory = pageId === "category" ? "all" : String(cfg.categories?.[0]?.id || "all");
  if (pageId === "category") {
    data.allProducts = productCatalog;
    data.visibleProducts = productCatalog;
  }
  if (productDetailIndex >= 0) {
    data.productCatalog = productCatalog;
    data.productMissing = false;
  }

  const body = blocks.map((block, index) => {
    const key = `block${index}`;
    const props = block.props || {};
    const style = block.style || {};
    const inlineStyle = blockInlineStyle(style, cfg);
    data[`${key}Hotspots`] = normalizeHotspots(props.hotspots);

    if (block.type === "hero") {
      const fallback = cfg.heroes[Number(props.heroIndex || 0)] || cfg.heroes[0] || {};
      data[key] = (props.slides?.length ? props.slides : [{
        id: `legacy-${index}`, kind: "image", src: fallback.img, title: fallback.title,
        subtitle: fallback.sub, showButton: props.showButton !== false,
        buttonText: props.buttonText || "探索更多", linkType: "category", linkValue: "/pages/category/category"
      }]).map(slide => ({ ...slide, src: slide.src || slide.img, subtitle: slide.subtitle || slide.sub || "", hotspots: normalizeHotspots(slide.hotspots) }));
      data[`${key}Autoplay`] = props.autoplay !== false;
      data[`${key}Interval`] = Math.max(2, Math.min(15, Number(props.interval || 5))) * 1000;
      const height = Math.max(280, Math.min(680, Number(style.height || 460)));
      const transitionDuration = props.transition === "none" ? 0 : props.transition === "fade" ? 900 : 500;
      return `<view class="builder-block" style="${escapeXml(inlineStyle)}"><swiper class="builder-hero" style="height:${height}px" autoplay="{{${key}Autoplay}}" circular="{{${key}.length > 1}}" interval="{{${key}Interval}}" duration="${transitionDuration}">
  <swiper-item wx:for="{{${key}}}" wx:key="id">
    <video wx:if="{{item.kind === 'video'}}" src="{{item.src}}" poster="{{item.poster}}" class="builder-cover" autoplay="{{${key}Autoplay}}" muted loop controls="{{false}}" object-fit="cover"></video>
    <image wx:else src="{{item.src}}" mode="aspectFill" class="builder-cover" />
    <view class="builder-mask" style="background:rgba(0,0,0,${Math.max(0, Math.min(80, Number(style.overlay ?? 40))) / 100})"></view>
    <view wx:for="{{item.hotspots}}" wx:for-item="spot" wx:key="id" class="builder-hotspot" style="left:{{spot.x}}%;top:{{spot.y}}%;width:{{spot.width}}%;height:{{spot.height}}%" data-link-type="{{spot.linkType}}" data-link-value="{{spot.linkValue}}" catchtap="hotspotAction"></view>
    <view wx:if="{{item.showContent !== false || item.showButton}}" class="builder-hero-copy">
      <block wx:if="{{item.showContent !== false}}">
        <view class="builder-eyebrow">PRIVLAN COLLECTION</view>
        <view class="builder-hero-title serif">{{item.title}}</view>
        <view class="builder-hero-sub">{{item.subtitle}}</view>
      </block>
      <view wx:if="{{item.showButton}}" class="builder-outline" style="${escapeXml(buttonInlineStyle(style, cfg))}" data-link-type="{{item.linkType}}" data-link-value="{{item.linkValue}}" bindtap="heroAction">{{item.buttonText}}</view>
    </view>
  </swiper-item>
</swiper></view>`;
    }

    if (block.type === "media") {
      const media = { mode: "color", src: "", fit: "cover", position: "center", autoplay: true, loop: true, muted: true, controls: false, linkType: "", linkValue: "", hotspots: [], ...props };
      media.hotspots = normalizeHotspots(media.hotspots);
      data[key] = media;
      const height = Math.max(80, Math.min(900, Number(style.height || 360)));
      const overlay = Math.max(0, Math.min(80, Number(style.overlay || media.overlay || 0))) / 100;
      const objectFit = media.fit === "contain" ? "contain" : "cover";
      return `<view class="builder-media builder-block" style="${escapeXml(`${inlineStyle};height:${height}px`)}" data-link-type="{{${key}.linkType}}" data-link-value="{{${key}.linkValue}}" bindtap="mediaAction">
  <video wx:if="{{${key}.mode === 'video' && ${key}.src}}" class="builder-media-content" src="{{${key}.src}}" autoplay="{{${key}.autoplay}}" loop="{{${key}.loop}}" muted="{{${key}.muted}}" controls="{{${key}.controls}}" object-fit="${objectFit}"></video>
  <image wx:elif="{{${key}.mode === 'image' && ${key}.src}}" class="builder-media-content" src="{{${key}.src}}" mode="${objectFit === "contain" ? "aspectFit" : "aspectFill"}" style="object-position:${cssValue(media.position || "center")}" />
  ${overlay ? `<view class="builder-media-overlay" style="background:rgba(0,0,0,${overlay})"></view>` : ""}
  <view wx:for="{{${key}.hotspots}}" wx:for-item="spot" wx:key="id" class="builder-hotspot" style="left:{{spot.x}}%;top:{{spot.y}}%;width:{{spot.width}}%;height:{{spot.height}}%" data-link-type="{{spot.linkType}}" data-link-value="{{spot.linkValue}}" catchtap="hotspotAction"></view>
</view>`;
    }

    if (block.type === "categories") {
      const categories = cfg.categories.slice(0, Number(props.count || 5));
      data[key] = pageId === "category" ? [{ id: "all", name: "全部商品" }, ...categories] : categories;
      return `<scroll-view scroll-x class="builder-categories builder-block" style="${escapeXml(inlineStyle)}" enable-flex>
  <view wx:for="{{${key}}}" wx:key="id" class="builder-category {{activeCategory === item.id ? 'on' : ''}}" data-category="{{item.id}}" bindtap="selectCategory">{{item.name}}</view>
</scroll-view>`;
    }

    if (block.type === "product-grid") {
      const source = props.category && props.category !== "all"
        ? cfg.products.filter(product => product.cat === props.category)
        : cfg.products;
      data[key] = source.slice(0, Number(props.count || 6));
      const columns = Math.max(2, Math.min(4, Number(props.columns || 2)));
      const gap = Math.max(4, Math.min(30, Number(style.gap || 12)));
      const listExpression = pageId === "category" && categoryGridIndex === index ? "visibleProducts" : key;
      const viewAllCategory = props.category && props.category !== "all" ? props.category : "all";
      return `<view class="builder-products builder-block" style="${escapeXml(inlineStyle)}">
  <view class="builder-section-head"><text class="serif">${escapeXml(props.title || block.name || "精选商品")}</text><text class="builder-more" data-category="${escapeXml(viewAllCategory)}" bindtap="viewAllProducts">查看全部</text></view>
  <view class="builder-grid" style="grid-template-columns:repeat(${columns},1fr);gap:${gap}px">
    <view wx:for="{{${listExpression}}}" wx:key="id" class="builder-product" data-id="{{item.id}}" bindtap="goDetail">
      <image class="builder-product-img" src="{{item.img}}" mode="aspectFill" />
      ${props.showName === false ? "" : `<view class="builder-product-name">{{item.name}}</view>`}
      ${props.showPrice === false ? "" : `<view class="builder-product-price">¥{{item.price}}</view>`}
    </view>
  </view>
</view>`;
    }

    if (block.type === "member-banner") {
      const benefitDefaults = [
        "/pages/category/category?cat=new",
        "/pages/service-chat/index",
        "/pages/appointment/index",
        "/pages/my-appointments/index"
      ];
      data[key] = (cfg.memberBenefits || []).map((benefit, benefitIndex) => ({
        ...benefit,
        linkType: benefit.linkType || "page",
        linkValue: benefit.linkValue || benefitDefaults[benefitIndex] || "/pages/mine/mine"
      }));
      return `<view class="builder-member builder-block" style="${escapeXml(inlineStyle)}">
  ${props.useBrandLogo === false ? `<view class="builder-member-title serif">${escapeXml(props.title || cfg.brand.name)}</view>` : `<image class="builder-member-logo" src="/images/privlan-ai-logo-white.png" mode="aspectFit" />`}
  <view class="builder-member-sub">${escapeXml(props.subtitle || cfg.brand.slogan || "")}</view>
  <view class="builder-benefits"><button wx:for="{{${key}}}" wx:key="text" class="builder-benefit" data-link-type="{{item.linkType}}" data-link-value="{{item.linkValue}}" bindtap="benefitAction"><image src="{{item.icon}}" mode="aspectFit" /><text>{{item.text}}</text></button></view>
</view>`;
    }

    if (block.type === "product-detail") {
      const product = productCatalog.find(item => String(item.id) === String(props.productId)) || null;
      data[key] = product || { id: "", gallery: [], colors: [], sizes: [], description: "", detailImages: [] };
      data.productMissing = !product;
      data.detailFallbackId = props.productId == null ? "" : String(props.productId);
      return `<view wx:if="{{!productMissing}}" class="builder-detail builder-block" style="${escapeXml(inlineStyle)}">
  <swiper class="builder-detail-gallery" indicator-dots="{{${key}.gallery.length > 1}}" circular="{{${key}.gallery.length > 1}}" duration="260">
    <swiper-item wx:for="{{${key}.gallery}}" wx:key="*this"><image class="builder-detail-image" src="{{item}}" mode="aspectFill" /></swiper-item>
  </swiper>
  <view class="builder-detail-kicker">PRIVLAN COLLECTION</view>
  <view class="builder-detail-name serif">{{${key}.name}}</view>
  ${props.showPrice === false ? "" : `<view class="builder-detail-price">¥{{${key}.price}}</view>`}
  <view wx:if="{{${key}.description}}" class="builder-detail-copy">{{${key}.description}}</view>
  <view wx:if="{{${key}.colors.length}}" class="builder-detail-options"><text class="builder-detail-label">颜色</text><text wx:for="{{${key}.colors}}" wx:key="name" class="builder-detail-option">{{item.name}}</text></view>
  <view wx:if="{{${key}.sizes.length}}" class="builder-detail-options"><text class="builder-detail-label">尺码</text><text wx:for="{{${key}.sizes}}" wx:key="*this" class="builder-detail-option">{{item}}</text></view>
  <view wx:if="{{${key}.detail}}" class="builder-detail-long-copy">{{${key}.detail}}</view>
  <view wx:if="{{${key}.detailImages.length}}" class="builder-detail-story"><image wx:for="{{${key}.detailImages}}" wx:key="*this" src="{{item}}" mode="widthFix" /></view>
  ${props.showActions === false ? "" : `<view class="builder-detail-actions"><button bindtap="addCart">加入购物车</button><button class="primary" bindtap="buyNow">立即购买</button></view>`}
</view><view wx:else class="builder-detail-missing"><view class="builder-detail-name serif">商品不存在</view><view class="builder-detail-copy">该商品可能已下架或链接无效。</view><button bindtap="goBack">返回上一页</button></view>`;
    }

    if (block.type === "text") {
      return `<view class="builder-text builder-block" style="${escapeXml(inlineStyle)}"><view class="builder-text-title serif">${escapeXml(props.title || "")}</view><view class="builder-text-copy">${escapeXml(props.text || "")}</view></view>`;
    }

    if (block.type === "spacer") {
      return `<view class="builder-block" style="${escapeXml(`${inlineStyle};height:${Math.max(8, Math.min(200, Number(style.height || 30)))}px`)}"></view>`;
    }

    return "";
  }).map((markup, index) => `<view class="builder-hotspot-host">${markup}${blockHotspotLayer(`block${index}`)}</view>`).join("\n");

  const cartPanel = pageId === "cart" ? `<view class="builder-cart-panel">
  <view wx:if="{{!cartItems.length}}" class="builder-cart-empty"><image class="builder-cart-empty-icon" src="/images/tab-bag.png" mode="aspectFit" /><view class="builder-cart-empty-title">购物车还是空的</view><view class="builder-cart-empty-copy">从商品详情加入商品后，会显示在这里。</view><button bindtap="explore">去选购</button></view>
  <block wx:else><view class="builder-cart-head"><text>已选 {{cartSummary.quantity}} 件</text><text class="builder-cart-accent">¥{{cartSummary.price}}</text></view><view wx:for="{{cartItems}}" wx:key="id" class="builder-cart-line"><image src="{{item.img}}" mode="aspectFill" /><view class="builder-cart-copy"><text class="builder-cart-name">{{item.name}}</text><text class="builder-cart-price">¥{{item.price}}</text><view class="builder-cart-quantity"><button data-id="{{item.id}}" data-delta="-1" bindtap="changeCartQuantity">-</button><text>{{item.quantity}}</text><button data-id="{{item.id}}" data-delta="1" bindtap="changeCartQuantity">+</button></view></view><text class="builder-cart-accent">¥{{item.lineTotal}}</text></view><view class="builder-cart-total"><text>合计</text><text class="builder-cart-accent">¥{{cartSummary.price}}</text></view></block>
</view>` : "";

  const navContent = pageId === "home"
    ? `<image class="builder-search" src="/images/icon-search.png" mode="aspectFit" bindtap="onSearch" /><view class="builder-channels"><text wx:for="{{channels}}" wx:key="*this" class="builder-channel {{channel === item ? 'on' : ''}}" data-c="{{item}}" bindtap="switchChannel">{{item}}</text></view>`
    : tabIndex >= 0 ? "" : `<image class="builder-search" src="/images/icon-back.png" mode="aspectFit" bindtap="goBack" /><view class="builder-page-title">{{pageTitle}}</view>`;
  const wxml = `<view class="builder-page">
  <view class="builder-nav" style="padding-top:{{navPadTop}}px">
    ${navContent}
  </view>
  <view class="builder-content">${cartPanel}${body}</view>
  <service-fab enabled="{{serviceBot.enabled}}" icon="{{serviceBot.icon}}" size="{{serviceBot.size}}" right="{{serviceBot.right}}" bottom="{{serviceBot.bottom}}" />
</view>`;

  const usesCart = pageId === "cart" || productDetailIndex >= 0;
  const cartImport = usesCart ? `const cart = require("../../utils/cart");\n` : "";
  const cartMethods = usesCart ? `
  refreshCart() {
    const items = cart.read().map(item => ({ ...item, lineTotal: (Number(item.price) || 0) * (Number(item.quantity) || 0) }));
    this.setData({ cartItems: items, cartSummary: cart.summary(items) });
  },
  changeCartQuantity(e) {
    cart.changeQuantity(e.currentTarget.dataset.id, e.currentTarget.dataset.delta);
    this.refreshCart();
  },${productDetailIndex >= 0 ? `
  addCart() {
    const product = this.data.block${productDetailIndex};
    if (!product || product.id === "" || product.id == null) return wx.showToast({ title: "商品不存在", icon: "none" });
    cart.add(product); this.refreshCart(); wx.showToast({ title: "已加入购物车", icon: "success" });
  },
  buyNow() {
    const product = this.data.block${productDetailIndex};
    if (!product || product.id === "" || product.id == null) return wx.showToast({ title: "商品不存在", icon: "none" });
    cart.add(product); wx.switchTab({ url: "/pages/cart/cart" });
  },` : ""}` : "";
  const detailLoad = productDetailIndex >= 0 ? `
    const requestedId = options && options.id != null && options.id !== "" ? String(options.id) : "";
    const targetId = requestedId || String(this.data.detailFallbackId || "");
    const product = this.data.productCatalog.find(item => String(item.id) === targetId);
    this.setData({ productMissing: !product, block${productDetailIndex}: product || { id: "", gallery: [], colors: [], sizes: [], description: "", detailImages: [] } });` : "";
  const js = `// Generated by PRIVLAN Commerce Studio. Edit the homepage in the admin panel.
${cartImport}Page({
  data: ${JSON.stringify(data, null, 4)},
  onLoad(options = {}) {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect();
    this.setData({ navPadTop: menu.top || win.statusBarHeight || 20 });${detailLoad}${pageId === "category" ? `
    this.applyCategory(options.cat);` : ""}
  },
  onShow() {${tabIndex >= 0 ? `
    if (typeof this.getTabBar === "function" && this.getTabBar()) this.getTabBar().setData({ selected: ${tabIndex} });` : ""}${usesCart ? `
    this.refreshCart();` : ""}
  },${cartMethods}
  switchChannel(e) { this.setData({ channel: e.currentTarget.dataset.c }); },
  onSearch() { wx.showToast({ title: "搜索功能开发中", icon: "none" }); },
  applyCategory(category) {
    const legal = new Set(["all", ...this.data.allProducts.map(item => item.cat)]);
    const activeCategory = legal.has(String(category || "")) ? String(category) : "all";
    const visibleProducts = activeCategory === "all" ? this.data.allProducts : this.data.allProducts.filter(item => item.cat === activeCategory);
    this.setData({ activeCategory, visibleProducts });
  },
  selectCategory(e) {
    const category = e.currentTarget.dataset.category || "all";
    ${pageId === "category" ? "this.applyCategory(category);" : `wx.reLaunch({ url: "/pages/category/category" + (category === "all" ? "" : "?cat=" + encodeURIComponent(category)) });`}
  },
  viewAllProducts(e) {
    const category = e.currentTarget.dataset.category || "all";
    ${pageId === "category" ? "this.applyCategory(category);" : `wx.reLaunch({ url: "/pages/category/category" + (category === "all" ? "" : "?cat=" + encodeURIComponent(category)) });`}
  },
  heroAction(e) {
    const type = e.currentTarget.dataset.linkType;
    const value = e.currentTarget.dataset.linkValue;
    if (!value) return;
    const clean = value.split("?")[0];
    const tabs = ["/pages/home/home", "/pages/category/category", "/pages/campaign/campaign", "/pages/cart/cart", "/pages/mine/mine"];
    if (clean === "/pages/category/category" && value.includes("?")) wx.reLaunch({ url: value });
    else if (tabs.includes(clean)) wx.switchTab({ url: clean });
    else if (type === "external") wx.navigateTo({ url: "/pages/webview/webview?url=" + encodeURIComponent(value) });
    else wx.navigateTo({ url: value });
  },
  mediaAction(e) { this.heroAction(e); },
  benefitAction(e) { this.heroAction(e); },
  hotspotAction(e) { this.heroAction(e); },
  explore() { wx.switchTab({ url: "/pages/category/category" }); },
  goDetail(e) { wx.navigateTo({ url: "/pages/detail/detail?id=" + e.currentTarget.dataset.id }); },
  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/home/home" }) }); },
  onShareAppMessage() {
    const path = ${productDetailIndex >= 0 ? `this.data.block${productDetailIndex} && this.data.block${productDetailIndex}.id !== "" ? "/pages/detail/detail?id=" + encodeURIComponent(this.data.block${productDetailIndex}.id) : "/pages/detail/detail"` : JSON.stringify(pageMeta.path || `/pages/${pageId}/${pageId}`)};
    return { title: ${JSON.stringify(pageMeta.shareTitle || pageMeta.name || cfg.brand.name)}, path${pageMeta.shareImage ? `, imageUrl: ${JSON.stringify(pageMeta.shareImage)}` : ""} };
  },
  onShareTimeline() {
    return { title: ${JSON.stringify(pageMeta.shareTitle || pageMeta.name || cfg.brand.name)}${productDetailIndex >= 0 ? `, query: this.data.block${productDetailIndex} && this.data.block${productDetailIndex}.id !== "" ? "id=" + encodeURIComponent(this.data.block${productDetailIndex}.id) : ""` : ""}${pageMeta.shareImage ? `, imageUrl: ${JSON.stringify(pageMeta.shareImage)}` : ""} };
  }
});
`;

  const customFonts = (cfg.customFonts || []).filter(font => font.url).map(font => `@font-face{font-family:'${cssValue(font.id)}';src:url('${cssValue(font.url)}');font-display:swap}`).join("");
  const memberLogoStyles = `.builder-member{background:#000;color:#fff}.builder-member-logo{display:block;width:360rpx;height:72rpx;margin:0 auto 18rpx;background:#000}.builder-member-title,.builder-member-sub,.builder-benefits{transform:translateY(16rpx)}.builder-member-title{color:#fff}.builder-member-sub{color:#fff}.builder-benefit{min-width:0;margin:0;padding:22rpx 4rpx 0;border:0;border-top:1rpx solid ${colors.border};border-radius:0;background:transparent;color:#fff;line-height:${type.bodyLineHeight}}.builder-benefit::after{border:0}`;
  const productDetailStyles = `.builder-detail-gallery{width:100%;height:auto;aspect-ratio:1/1.12;background:${colors.bgSecondary}}.builder-detail-gallery swiper-item{height:100%}.builder-detail-options{display:flex;align-items:center;flex-wrap:wrap;gap:10rpx;margin-top:18rpx}.builder-detail-label{color:${colors.textSecondary};font-size:${type.meta}rpx;margin-right:6rpx}.builder-detail-option{padding:8rpx 18rpx;border:1rpx solid ${colors.border};border-radius:99rpx;font-size:${type.meta}rpx}.builder-detail-long-copy{margin-top:24rpx;color:${colors.textSecondary};font-size:${type.body}rpx;line-height:${type.bodyLineHeight};white-space:pre-line}.builder-detail-story{margin-top:24rpx}.builder-detail-story image{display:block;width:100%;margin-bottom:14rpx}`;
  const mediaStyles = ".builder-media{position:relative;width:100%;overflow:hidden}.builder-media-content{display:block;width:100%;height:100%}.builder-media-overlay{position:absolute;inset:0;pointer-events:none}.builder-hero swiper-item{position:relative}.builder-hotspot-host{position:relative}.builder-hotspot{position:absolute;z-index:8;background:transparent;display:block}";
  const cartStyles = `.builder-cart-panel{padding:32px 15px 18px}.builder-cart-empty{min-height:190px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;border:1rpx solid ${colors.border};text-align:center}.builder-cart-empty-icon{display:block;width:52rpx;height:52rpx;margin-bottom:10rpx}.builder-cart-empty-title{font-size:${type.sectionTitle}rpx;font-weight:600;line-height:${type.headingLineHeight}}.builder-cart-empty-copy{margin-top:8rpx;color:${colors.textSecondary};font-size:${type.body}rpx;line-height:${type.bodyLineHeight}}.builder-cart-empty button{min-height:88rpx;margin-top:18rpx;padding:0 32rpx;border:1rpx solid ${colors.accent};background:transparent;color:${colors.accent};font-size:${type.body}rpx;line-height:88rpx}.builder-cart-head,.builder-cart-total{display:flex;align-items:center;justify-content:space-between;color:${colors.textSecondary};font-size:${type.meta}rpx}.builder-cart-head{padding-bottom:18rpx;border-bottom:1rpx solid ${colors.border}}.builder-cart-accent{color:${colors.accent}}.builder-cart-line{display:grid;grid-template-columns:136rpx minmax(0,1fr) auto;gap:20rpx;align-items:center;padding:22rpx 0;border-bottom:1rpx solid ${colors.border}}.builder-cart-line>image{width:136rpx;height:172rpx;background:${colors.bgSecondary}}.builder-cart-copy{min-width:0}.builder-cart-name{display:block;overflow:hidden;font-size:${type.body}rpx;white-space:nowrap;text-overflow:ellipsis}.builder-cart-price{display:block;margin-top:8rpx;color:${colors.accent};font-size:${type.meta}rpx}.builder-cart-quantity{display:grid;grid-template-columns:64rpx 48rpx 64rpx;align-items:center;width:176rpx;margin-top:16rpx;border:1rpx solid ${colors.border}}.builder-cart-quantity button{width:64rpx;height:64rpx;padding:0;border:0;background:transparent;color:${colors.textPrimary};font-size:30rpx;line-height:64rpx}.builder-cart-quantity text{text-align:center;font-size:${type.meta}rpx}.builder-cart-total{padding-top:24rpx}.builder-cart-total .builder-cart-accent{font-size:${type.body}rpx}`;
  const wxss = `${customFonts}.builder-page{min-height:100vh;background:${colors.bgPrimary};color:${colors.textPrimary};padding-bottom:130rpx;font-family:${FONT_STACKS.system};font-size:${type.body}rpx;line-height:${type.bodyLineHeight}}.builder-block{box-sizing:border-box;overflow:hidden}.builder-nav{position:fixed;top:0;left:0;right:0;z-index:100;height:44px;padding-left:24rpx;padding-right:24rpx;display:flex;align-items:center;background:linear-gradient(to bottom,rgba(0,0,0,.62),transparent)}.builder-search{width:40rpx;height:40rpx}.builder-page-title{flex:1;margin-right:40rpx;text-align:center;color:#fff;font-size:${type.pageTitle}rpx;font-weight:600;line-height:${type.headingLineHeight}}.builder-channels{flex:1;display:flex;justify-content:center;gap:44rpx;margin-right:120rpx}.builder-channel{font-size:${type.body}rpx;color:rgba(255,255,255,.72);padding-bottom:8rpx}.builder-channel.on{color:${colors.accent};border-bottom:2rpx solid ${colors.accent}}.builder-cover{width:100%;height:100%;display:block}.builder-hero{position:relative;width:100%;background:${colors.bgSecondary}}.builder-mask{position:absolute;inset:0}.builder-hero-copy{position:absolute;left:40rpx;right:40rpx;bottom:84rpx;text-align:inherit}.builder-eyebrow{font-size:${type.caption}rpx;color:rgba(255,255,255,.82)}.builder-hero-title{margin:16rpx 0 8rpx;font-size:${type.heroTitle}rpx;line-height:${type.headingLineHeight};color:inherit}.builder-hero-sub{font-size:${type.body}rpx;line-height:${type.bodyLineHeight};color:inherit;opacity:.9}.builder-outline{display:inline-flex;align-items:center;justify-content:center;min-height:88rpx;margin-top:34rpx;padding:0 48rpx;font-size:${type.body}rpx}.builder-categories{white-space:nowrap}.builder-category{display:inline-flex;align-items:center;min-height:72rpx;margin-right:16rpx;padding:0 24rpx;border:1rpx solid ${colors.border};border-radius:99rpx;color:${colors.textSecondary};font-size:${type.body}rpx}.builder-category.on{background:${colors.accent};border-color:${colors.accent};color:${colors.bgPrimary}}.builder-section-head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:28rpx;font-size:${type.sectionTitle}rpx;line-height:${type.headingLineHeight}}.builder-more{color:${colors.textSecondary};font-size:${type.meta}rpx}.builder-grid{display:grid}.builder-product-img{width:100%;aspect-ratio:3/4;background:${colors.bgSecondary}}.builder-product-name{margin-top:12rpx;font-size:${type.body}rpx;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.builder-product-price{margin-top:5rpx;color:${colors.accent};font-size:${type.meta}rpx}.builder-member{text-align:inherit}.builder-member-title{color:inherit;font-size:${type.pageTitle}rpx;line-height:${type.headingLineHeight}}.builder-member-sub{margin:14rpx 0 32rpx;color:inherit;opacity:.78;font-size:${type.body}rpx;line-height:${type.bodyLineHeight}}.builder-benefits{display:grid;grid-template-columns:repeat(4,1fr);gap:12rpx}.builder-benefit{border-top:1rpx solid ${colors.border};padding-top:22rpx;display:flex;flex-direction:column;align-items:center;font-size:${type.caption}rpx}.builder-benefit image{width:44rpx;height:44rpx;margin-bottom:10rpx}.builder-detail-image{width:100%;aspect-ratio:1/1.12;background:${colors.bgSecondary}}.builder-detail-kicker{margin-top:28rpx;color:${colors.accent};font-size:${type.caption}rpx}.builder-detail-name{margin-top:12rpx;font-size:${type.pageTitle}rpx;line-height:${type.headingLineHeight}}.builder-detail-price{margin-top:8rpx;color:${colors.accent};font-size:${type.body}rpx}.builder-detail-copy{margin:24rpx 0 32rpx;color:${colors.textSecondary};font-size:${type.body}rpx;line-height:${type.bodyLineHeight}}.builder-detail-actions{display:grid;grid-template-columns:1fr 1fr;gap:16rpx}.builder-detail-actions button{min-height:88rpx;border:1rpx solid ${colors.accent};background:transparent;color:${colors.accent};font-size:${type.body}rpx}.builder-detail-actions button.primary{background:${colors.accent};color:${colors.bgPrimary}}.builder-detail-missing{padding:240rpx 48rpx 120rpx;text-align:center}.builder-detail-missing button{min-height:88rpx;padding:0 48rpx;border:1rpx solid ${colors.accent};background:transparent;color:${colors.accent}}.builder-text-title{color:inherit;font-size:${type.sectionTitle}rpx;line-height:${type.headingLineHeight}}.builder-text-copy{margin-top:14rpx;color:inherit;opacity:.78;font-size:${type.body}rpx;line-height:${type.bodyLineHeight}}.builder-service{position:fixed;z-index:1000;right:24rpx;bottom:150rpx;width:88rpx;height:88rpx;border-radius:50%;background:${colors.bgSecondary};border:1rpx solid ${colors.accent};padding:0;display:flex;align-items:center;justify-content:center;touch-action:none;user-select:none}.builder-service::after{border:0}.builder-service image{width:52%;height:52%}`;

  fs.writeFileSync(path.join(pageDir, `${pageId}.wxml`), wxml, "utf-8");
  fs.writeFileSync(path.join(pageDir, `${pageId}.js`), js, "utf-8");
  fs.writeFileSync(path.join(pageDir, `${pageId}.wxss`), wxss + memberLogoStyles + productDetailStyles + mediaStyles + cartStyles, "utf-8");
  const jsonPath = path.join(pageDir, `${pageId}.json`);
  const pageJson = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf-8")) : {};
  pageJson.navigationBarTitleText = pageMeta.name || cfg.brand.name;
  pageJson.enableShareAppMessage = true;
  pageJson.enableShareTimeline = true;
  fs.writeFileSync(jsonPath, JSON.stringify(pageJson, null, 2) + "\n", "utf-8");
  return [`pages/${pageId}/${pageId}.wxml`, `pages/${pageId}/${pageId}.js`, `pages/${pageId}/${pageId}.wxss`, `pages/${pageId}/${pageId}.json`];
}

function syncAppointmentLayout(cfg, root, pageMeta = {}) {
  const pageDir = path.join(root, "pages", "appointment");
  if (!fs.existsSync(pageDir)) return [];
  const colors = cfg.theme.colors || {};
  const blocks = (cfg.pageLayouts.appointment || []).filter(block => block.enabled !== false && block.visibility?.mobile !== false);
  const hero = blocks.find(block => block.type === "appointment-hero");
  const form = blocks.find(block => block.type === "appointment-form");
  const notes = blocks.find(block => block.type === "appointment-notes");
  const submit = blocks.find(block => block.type === "appointment-submit");
  const heroProps = hero?.props || cfg.appointment || {};
  const formProps = form?.props || {};
  const notesProps = notes?.props || {};
  const submitProps = submit?.props || {};
  const fields = {
    name: formProps.showName !== false,
    phone: formProps.showPhone !== false,
    service: formProps.showService !== false,
    store: formProps.showStore !== false,
    date: formProps.showDate !== false,
    time: formProps.showTime !== false,
    advisor: formProps.showAdvisor !== false,
    notes: Boolean(notes)
  };
  const appointmentConfig = {
    kicker: String(heroProps.kicker || "PRIVLAN APPOINTMENT"),
    title: String(heroProps.title || "预约专属服务"),
    description: String(heroProps.description || "选择适合你的门店、时间和顾问，我们会提前做好准备。"),
    submitText: String(submitProps.buttonText || "确认预约"),
    successTitle: String(submitProps.successTitle || "预约已提交"),
    successCopy: String(submitProps.successCopy || "我们会尽快确认你的预约，请留意顾问联系。"),
    notesLabel: String(notesProps.label || "到店备注"),
    notesPlaceholder: String(notesProps.placeholder || "可填写想了解的款式、场合或其他需求"),
    fields
  };
  const configPath = path.join(root, "utils", "appointment-config.js");
  fs.writeFileSync(configPath, `// Generated by PRIVLAN Commerce Studio.\nmodule.exports = ${JSON.stringify(appointmentConfig, null, 2)};\n`, "utf-8");
  const style = block => escapeXml(blockInlineStyle(block?.style || {}, cfg));
  const body = blocks.map(block => {
    const props = block.props || {};
    if (block.type === "appointment-hero") {
      const heroStyle = `${style(block)};background-color:${cssValue(block.style?.backgroundColor || "#171717")}${heroProps.backgroundSrc ? `;background-image:url('${cssValue(heroProps.backgroundSrc)}');background-size:${cssValue(heroProps.backgroundFit || "cover")};background-position:${cssValue(heroProps.backgroundPosition || "center")}` : ""}`;
      return `<view class="appointment-hero" style="${escapeXml(heroStyle)}"><view class="kicker">${escapeXml(appointmentConfig.kicker)}</view><view class="title">${escapeXml(appointmentConfig.title)}</view><view class="copy">${escapeXml(appointmentConfig.description)}</view></view>`;
    }
    if (block.type === "appointment-form") return `<view class="appointment-form" style="${style(block)}">
  ${fields.name || fields.phone ? `<view class="form-section"><view class="section-number">01</view><view class="section-title">预约人信息</view>${fields.name ? `<label class="field"><text>姓名</text><input value="{{form.name}}" data-field="name" maxlength="24" bindinput="onInput" placeholder="请输入预约人姓名" /></label><view wx:if="{{errors.name}}" class="field-error">{{errors.name}}</view>` : ""}${fields.phone ? `<label class="field"><text>联系电话</text><input value="{{form.phone}}" data-field="phone" type="number" maxlength="11" bindinput="onInput" placeholder="请输入手机号" /></label><view wx:if="{{errors.phone}}" class="field-error">{{errors.phone}}</view>` : ""}</view>` : ""}
  ${fields.service || fields.store ? `<view class="form-section"><view class="section-number">02</view><view class="section-title">服务与门店</view>${fields.service ? `<view class="choice-grid"><button wx:for="{{services}}" wx:key="id" class="{{form.serviceId === item.id ? 'selected' : ''}}" data-value="{{item.id}}" bindtap="selectService"><text class="option-name">{{item.name}}</text><text>{{item.description}}</text></button></view><view wx:if="{{errors.serviceId}}" class="field-error">{{errors.serviceId}}</view>` : ""}${fields.store ? `<view class="store-list"><button wx:for="{{stores}}" wx:key="id" class="{{form.storeId === item.id ? 'selected' : ''}}" data-value="{{item.id}}" bindtap="selectStore"><view><text class="option-name">{{item.name}}</text><text>{{item.address}}</text></view><view class="radio-mark"></view></button></view><view wx:if="{{errors.storeId}}" class="field-error">{{errors.storeId}}</view>` : ""}</view>` : ""}
  ${fields.date || fields.time ? `<view class="form-section"><view class="section-number">03</view><view class="section-title">日期与时间</view>${fields.date ? `<scroll-view class="date-strip" scroll-x enhanced show-scrollbar="{{false}}"><button wx:for="{{dates}}" wx:key="value" class="{{form.date === item.value ? 'selected' : ''}}" data-value="{{item.value}}" bindtap="selectDate"><text>{{item.weekday}}</text><text class="date-day">{{item.day}}</text><text>{{item.month}}</text></button></scroll-view><view wx:if="{{!dates.length}}" class="empty-inline">当前门店暂无开放日期</view>` : ""}${fields.time ? `<view class="slot-grid"><button wx:for="{{slots}}" wx:key="id" class="{{form.slotId === item.id ? 'selected' : ''}}" disabled="{{item.available === false}}" data-value="{{item.id}}" bindtap="selectSlot">{{item.label}}</button></view><view wx:if="{{form.date && !slots.length}}" class="empty-inline">该日期暂无可预约时间</view><view wx:if="{{errors.slotId}}" class="field-error">{{errors.slotId}}</view>` : ""}</view>` : ""}
  ${fields.advisor ? `<view class="form-section"><view class="section-number">04</view><view class="section-title">专属顾问</view><scroll-view class="advisor-strip" scroll-x enhanced show-scrollbar="{{false}}"><button wx:for="{{advisors}}" wx:key="id" class="{{form.advisorId === item.id ? 'selected' : ''}}" data-value="{{item.id}}" bindtap="selectAdvisor"><image src="{{item.avatar || '/images/icon-headset.png'}}" mode="aspectFill" /><text class="option-name">{{item.name}}</text><text>{{item.title || '品牌顾问'}}</text></button></scroll-view><view wx:if="{{!advisors.length}}" class="empty-inline">当前条件下暂无可选顾问</view><view wx:if="{{errors.advisorId}}" class="field-error">{{errors.advisorId}}</view></view>` : ""}
</view>`;
    if (block.type === "appointment-notes") return `<view class="form-section notes-section" style="${style(block)}"><view class="section-number">05</view><view class="section-title">${escapeXml(appointmentConfig.notesLabel)}</view><textarea value="{{form.notes}}" data-field="notes" maxlength="300" bindinput="onInput" placeholder="${escapeXml(appointmentConfig.notesPlaceholder)}" /><view class="counter">{{form.notes.length}} / 300</view></view>`;
    if (block.type === "appointment-submit") return "";
    return "";
  }).map((markup, index) => `<view style="position:relative">${markup}${staticHotspotLayer(blocks[index])}</view>`).join("\n");
  const wxml = `<view class="appointment-page"><view wx:if="{{loadError}}" class="state-card error"><view>{{loadError}}</view><button bindtap="loadOptions">重新加载</button></view><view wx:elif="{{loading}}" class="state-card"><view class="loading-line"></view><view class="loading-line short"></view><text>正在读取可预约时间</text></view><view wx:else>${body}</view><view class="submit-bar" style="${style(submit)}"><button loading="{{submitting}}" disabled="{{loading || submitting || loadError}}" bindtap="submitAppointment">${escapeXml(appointmentConfig.submitText)}</button></view><view wx:if="{{success}}" class="success-layer"><view class="success-card"><view class="success-mark">完成</view><view class="success-title">${escapeXml(appointmentConfig.successTitle)}</view><view class="success-copy">${escapeXml(appointmentConfig.successCopy)}</view><view class="success-detail"><text>预约编号</text><text class="detail-value">{{success.number}}</text><text>门店</text><text class="detail-value">{{success.storeName}}</text><text>时间</text><text class="detail-value">{{success.date}} {{success.slotLabel}}</text><text>顾问</text><text class="detail-value">{{success.advisorName}}</text></view><button bindtap="finish">完成</button></view></view><service-fab enabled="{{serviceBot.enabled}}" icon="{{serviceBot.icon}}" size="{{serviceBot.size}}" right="{{serviceBot.right}}" bottom="{{serviceBot.bottom}}" /></view>`;
  fs.writeFileSync(path.join(pageDir, "index.wxml"), wxml, "utf-8");
  const jsonPath = path.join(pageDir, "index.json");
  const pageJson = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf-8")) : {};
  pageJson.usingComponents = { ...(pageJson.usingComponents || {}), "service-fab": "/components/service-fab/index" };
  fs.writeFileSync(jsonPath, JSON.stringify(pageJson, null, 2) + "\n", "utf-8");
  return ["utils/appointment-config.js", "pages/appointment/index.wxml", "pages/appointment/index.json"];
}

module.exports = syncHomeLayout;
