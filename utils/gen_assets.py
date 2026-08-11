# -*- coding: utf-8 -*-
"""生成 PRIVLAN 小程序演示用的全部占位图片素材 —— 黑金主题"""
import os
import random
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "images")
os.makedirs(BASE, exist_ok=True)

FONT_PATHS = ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/arial.ttf"]

GOLD = (201, 169, 126)
GOLD_DARK = (160, 130, 88)
BLACK = (10, 10, 10)
DARK_BG = (22, 22, 22)
DARKER = (14, 14, 14)

def font(size):
    for p in FONT_PATHS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def gradient(draw, w, h, c1, c2):
    for y in range(h):
        t = y / max(h - 1, 1)
        r = int(c1[0] + (c2[0] - c1[0]) * t)
        g = int(c1[1] + (c2[1] - c1[1]) * t)
        b = int(c1[2] + (c2[2] - c1[2]) * t)
        draw.line([(0, y), (w, y)], fill=(r, g, b))

def scene(w, h, c1, c2, label, sub, fname, text_color=GOLD, sub_color=(200, 200, 200)):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    gradient(d, w, h, c1, c2)
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.polygon([(0, int(h * 0.75)), (int(w * 0.4), int(h * 0.45)), (int(w * 0.8), int(h * 0.75))], fill=(0, 0, 0, 50))
    od.polygon([(int(w * 0.35), int(h * 0.75)), (int(w * 0.75), int(h * 0.35)), (w, int(h * 0.75))], fill=(0, 0, 0, 65))
    od.rectangle([0, int(h * 0.74), w, h], fill=(0, 0, 0, 40))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    d = ImageDraw.Draw(img)
    f1, f2 = font(int(w * 0.07)), font(int(w * 0.035))
    tw = d.textlength(label, font=f1)
    d.text(((w - tw) / 2, h * 0.42), label, font=f1, fill=text_color)
    if sub:
        sw = d.textlength(sub, font=f2)
        d.text(((w - sw) / 2, h * 0.42 + int(w * 0.09)), sub, font=f2, fill=sub_color)
    img.save(os.path.join(BASE, fname), quality=88)

def product(fname, tone, label):
    w, h = 420, 520
    img = Image.new("RGB", (w, h), tone)
    d = ImageDraw.Draw(img)
    darker = tuple(max(c - 30, 0) for c in tone)
    d.rounded_rectangle([w * 0.28, h * 0.22, w * 0.72, h * 0.72], radius=18, fill=darker)
    f = font(22)
    tw = d.textlength(label, font=f)
    d.text(((w - tw) / 2, h * 0.82), label, font=f, fill=GOLD)
    img.save(os.path.join(BASE, fname), quality=88)

def icon(fname, draw_fn, color=(150, 150, 150), size=64):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_fn(d, size, color)
    img.save(os.path.join(BASE, fname))

def i_home(d, s, c):
    d.line([(s*0.18, s*0.5), (s*0.5, s*0.2), (s*0.82, s*0.5)], fill=c, width=4)
    d.rectangle([s*0.26, s*0.5, s*0.74, s*0.82], outline=c, width=4)

def i_grid(d, s, c):
    for dx in (0.22, 0.56):
        for dy in (0.22, 0.56):
            d.rectangle([s*dx, s*dy, s*dx+s*0.22, s*dy+s*0.22], outline=c, width=4)

def i_bag(d, s, c):
    d.rectangle([s*0.24, s*0.36, s*0.76, s*0.8], outline=c, width=4)
    d.arc([s*0.36, s*0.16, s*0.64, s*0.52], 180, 360, fill=c, width=4)

def i_user(d, s, c):
    d.ellipse([s*0.34, s*0.16, s*0.66, s*0.48], outline=c, width=4)
    d.arc([s*0.22, s*0.5, s*0.78, s*1.14], 180, 360, fill=c, width=4)

def i_search(d, s, c):
    d.ellipse([s*0.2, s*0.2, s*0.62, s*0.62], outline=c, width=4)
    d.line([(s*0.58, s*0.58), (s*0.8, s*0.8)], fill=c, width=5)

def i_headset(d, s, c):
    d.arc([s*0.22, s*0.2, s*0.78, s*0.76], 180, 360, fill=c, width=4)
    d.rectangle([s*0.18, s*0.46, s*0.3, s*0.68], outline=c, width=4)
    d.rectangle([s*0.7, s*0.46, s*0.82, s*0.68], outline=c, width=4)

def i_back(d, s, c):
    d.line([(s*0.62, s*0.2), (s*0.3, s*0.5), (s*0.62, s*0.8)], fill=c, width=5)

def i_gift(d, s, c):
    d.rectangle([s*0.22, s*0.36, s*0.78, s*0.8], outline=c, width=4)
    d.line([(s*0.5, s*0.36), (s*0.5, s*0.8)], fill=c, width=4)
    d.arc([s*0.28, s*0.16, s*0.5, s*0.4], 90, 270, fill=c, width=4)
    d.arc([s*0.5, s*0.16, s*0.72, s*0.4], 270, 90, fill=c, width=4)

def i_tailor(d, s, c):
    d.line([(s*0.3, s*0.75), (s*0.7, s*0.25)], fill=c, width=4)
    d.ellipse([s*0.2, s*0.7, s*0.38, s*0.86], outline=c, width=4)
    d.ellipse([s*0.62, s*0.14, s*0.8, s*0.3], outline=c, width=4)

def i_card(d, s, c):
    d.rectangle([s*0.18, s*0.3, s*0.82, s*0.74], outline=c, width=4)
    d.line([(s*0.18, s*0.44), (s*0.82, s*0.44)], fill=c, width=4)

def i_truck(d, s, c):
    d.rectangle([s*0.16, s*0.36, s*0.58, s*0.66], outline=c, width=4)
    d.line([(s*0.58, s*0.46), (s*0.76, s*0.46), (s*0.84, s*0.56), (s*0.84, s*0.66), (s*0.58, s*0.66)], fill=c, width=4)
    d.ellipse([s*0.24, s*0.64, s*0.36, s*0.76], outline=c, width=4)
    d.ellipse([s*0.64, s*0.64, s*0.76, s*0.76], outline=c, width=4)

def i_person(d, s, c):
    d.ellipse([s*0.36, s*0.18, s*0.64, s*0.46], outline=c, width=4)
    d.line([(s*0.28, s*0.8), (s*0.34, s*0.58), (s*0.66, s*0.58), (s*0.72, s*0.8)], fill=c, width=4)

def i_bagtag(d, s, c):
    d.rounded_rectangle([s*0.3, s*0.3, s*0.7, s*0.84], radius=8, outline=c, width=4)
    d.line([(s*0.5, s*0.3), (s*0.5, s*0.14)], fill=c, width=4)

def i_store(d, s, c):
    d.rectangle([s*0.24, s*0.4, s*0.76, s*0.8], outline=c, width=4)
    d.polygon([(s*0.18, s*0.4), (s*0.5, s*0.18), (s*0.82, s*0.4)], outline=c, width=4)

def fake_qr(fname, size=220):
    img = Image.new("RGB", (size, size), (255, 255, 255))
    d = ImageDraw.Draw(img)
    n = 21
    cell = size // (n + 2)
    rnd = random.Random(7)
    def finder(cx, cy):
        d.rectangle([cx*cell, cy*cell, (cx+7)*cell, (cy+7)*cell], fill=(0, 0, 0))
        d.rectangle([(cx+1)*cell, (cy+1)*cell, (cx+6)*cell, (cy+6)*cell], fill=(255, 255, 255))
        d.rectangle([(cx+2)*cell, (cy+2)*cell, (cx+5)*cell, (cy+5)*cell], fill=(0, 0, 0))
    for y in range(n):
        for x in range(n):
            in_finder = (x < 8 and y < 8) or (x > n - 9 and y < 8) or (x < 8 and y > n - 9)
            if not in_finder and rnd.random() < 0.42:
                d.rectangle([(x+1)*cell, (y+1)*cell, (x+2)*cell, (y+2)*cell], fill=(0, 0, 0))
    finder(1, 1)
    finder(n - 6, 1)
    finder(1, n - 6)
    img.save(os.path.join(BASE, fname))

# ---------- 场景大图 —— 黑金主题 ----------
# 首页轮播：深邃黑底 + 金色文字
scene(750, 1200, (35, 30, 25), (10, 10, 10), "SUNGLASSES", "发现新世界", "hero1.jpg")
scene(750, 1200, (28, 32, 38), (10, 10, 10), "LAKE MAGGIORE", "湖畔假日系列", "hero2.jpg")
scene(750, 1200, (30, 35, 28), (10, 10, 10), "OASI CASHMERE", "绿洲羊绒", "hero3.jpg")
# 会员 banner
scene(690, 330, (30, 25, 20), (10, 10, 10), "PRIVLAN", "成为会员 享受更多礼遇服务", "member.jpg")
# 场景图
scene(690, 430, (40, 35, 30), (15, 12, 10), "夏季系列", "探索全部", "scene.jpg")
# 活动页 hero
scene(750, 560, (32, 28, 35), (10, 10, 10), "LAKE MAGGIORE", "限时活动", "campaign-hero.jpg")
# 我的页面 banner
scene(750, 260, (25, 22, 18), (10, 10, 10), "PRIVLAN", "登录 / 注册", "mine-banner.jpg")
# 顾问 banner
scene(750, 300, (18, 16, 14), (10, 10, 10), "专属顾问", "扫描二维码 添加专属顾问", "advisor-banner.jpg")
# tab 中央
scene(240, 240, (201, 169, 126), (160, 130, 88), "夏季系列", "", "tab-center.png")

# ---------- 商品图 —— 暗色调 ----------
tones = {
    "p1.jpg": ((48, 44, 40), "羊绒开衫"),
    "p2.jpg": ((55, 48, 40), "羊毛大衣"),
    "p3.jpg": ((52, 50, 46), "亚麻衬衫"),
    "p4.jpg": ((30, 30, 34), "Polo 衫"),
    "p5.jpg": ((58, 54, 48), "休闲鞋"),
    "p6.jpg": ((42, 32, 24), "乐福鞋"),
    "p7.jpg": ((35, 38, 44), "羊毛长裤"),
    "p8.jpg": ((60, 40, 28), "皮革行李牌"),
}
for fname, (tone, label) in tones.items():
    product(fname, tone, label)

# ---------- tab 图标（灰 / 金两套） ----------
gray, gold = (140, 140, 140), GOLD
for name, fn in [("home", i_home), ("grid", i_grid), ("bag", i_bag), ("user", i_user)]:
    icon(f"tab-{name}.png", fn, gray, 64)
    icon(f"tab-{name}-on.png", fn, gold, 64)

# ---------- 功能图标 —— 浅色适配深色背景 ----------
icon("icon-search.png", i_search, (200, 200, 200), 64)
icon("icon-headset.png", i_headset, GOLD, 64)
icon("icon-headset-w.png", i_headset, (240, 240, 240), 64)
icon("icon-back.png", i_back, (200, 200, 200), 64)
icon("svc-presale.png", i_bag, GOLD, 72)
icon("svc-cs.png", i_headset, GOLD, 72)
icon("svc-tailor.png", i_tailor, GOLD, 72)
icon("svc-gift.png", i_gift, GOLD, 72)
icon("svc-card.png", i_card, (180, 180, 180), 72)
icon("svc-truck.png", i_truck, (180, 180, 180), 72)
icon("svc-person.png", i_person, (180, 180, 180), 72)
icon("svc-tag.png", i_bagtag, (180, 180, 180), 72)
icon("svc-store.png", i_store, (180, 180, 180), 72)
icon("svc-return.png", i_card, (180, 180, 180), 72)
icon("gift.png", i_bagtag, GOLD, 120)

fake_qr("qr.png")

print("assets generated:", len(os.listdir(BASE)))
