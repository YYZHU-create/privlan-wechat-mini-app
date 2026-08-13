// 由管理面板自动生成 —— 请勿手动编辑
const categories = [
  {
    "id": "new",
    "name": "早秋新品"
  },
  {
    "id": "summer",
    "name": "夏季系列"
  },
  {
    "id": "stitch",
    "name": "Triple Stitch"
  },
  {
    "id": "tops",
    "name": "上装"
  },
  {
    "id": "shoes",
    "name": "鞋履"
  },
  {
    "id": "bottoms",
    "name": "下装"
  },
  {
    "id": "acc",
    "name": "配饰"
  },
  {
    "id": "home",
    "name": "内衣及家居服"
  },
  {
    "id": "brand",
    "name": "品牌甄选"
  }
];

const products = [
  {
    "id": 6,
    "cat": "tops",
    "name": "0004",
    "price": 4900,
    "img": "/images/41b7d4277afa3c44ee45d3606b761c6e.jpg",
    "gallery": [
      "/images/41b7d4277afa3c44ee45d3606b761c6e.jpg"
    ],
    "colors": [],
    "sizes": [],
    "description": "",
    "detail": "",
    "detailImages": []
  },
  {
    "id": 5,
    "cat": "tops",
    "name": "0003",
    "price": 4900,
    "img": "/images/Kith_Giorgio_Armani__The_Archetype_Lookbook.jpeg",
    "gallery": [
      "/images/Kith_Giorgio_Armani__The_Archetype_Lookbook.jpeg"
    ],
    "colors": [],
    "sizes": [
      "新尺码"
    ],
    "description": "",
    "detail": "",
    "detailImages": []
  },
  {
    "id": 4,
    "cat": "tops",
    "name": "0002",
    "price": 4900,
    "img": "/images/29_0df4a244-de71-4b8a-a8c4-69ecaef14d83.jpeg",
    "gallery": [
      "/images/29_0df4a244-de71-4b8a-a8c4-69ecaef14d83.jpeg"
    ],
    "colors": [],
    "sizes": [],
    "description": "",
    "detail": "",
    "detailImages": []
  },
  {
    "id": 3,
    "cat": "tops",
    "name": "0001",
    "price": 4900,
    "img": "/images/7_33529103-a9a4-4ed2-bc1b-2dbca5c4bb89.jpeg",
    "gallery": [
      "/images/7_33529103-a9a4-4ed2-bc1b-2dbca5c4bb89.jpeg"
    ],
    "colors": [],
    "sizes": [],
    "description": "",
    "detail": "",
    "detailImages": []
  }
];

const heroes = [
  {
    "img": "/images/hero1.jpg",
    "title": "SUNGLASSES",
    "sub": "发现新世界",
    "channel": "推荐"
  },
  {
    "img": "/images/hero2.jpg",
    "title": "LAKE MAGGIORE",
    "sub": "湖畔假日系列",
    "channel": "LAKE MAGGIORE"
  },
  {
    "img": "/images/hero3.jpg",
    "title": "OASI CASHMERE",
    "sub": "绿洲羊绒",
    "channel": "推荐"
  }
];

const memberBenefits = [
  {
    "icon": "/images/svc-presale.png",
    "text": "新品预售",
    "linkType": "page",
    "linkValue": "/pages/category/category?cat=new"
  },
  {
    "icon": "/images/svc-cs.png",
    "text": "专属客服",
    "linkType": "page",
    "linkValue": "/pages/service-chat/index"
  },
  {
    "icon": "/images/svc-tailor.png",
    "text": "改衣服务",
    "linkType": "page",
    "linkValue": "/pages/appointment/index"
  },
  {
    "icon": "/images/svc-gift.png",
    "text": "尊享礼遇",
    "linkType": "page",
    "linkValue": "/pages/mine/mine"
  }
];

module.exports = { categories, products, heroes, memberBenefits };
