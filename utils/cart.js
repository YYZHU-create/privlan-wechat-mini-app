const STORAGE_KEY = "privlan-cart";

function read() {
  try {
    const items = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(items) ? items.filter(item => item && item.id && item.quantity > 0) : [];
  } catch (error) {
    return [];
  }
}

function write(items) {
  wx.setStorageSync(STORAGE_KEY, items.filter(item => item && item.quantity > 0));
}

function add(product) {
  if (!product || product.id === undefined || product.id === null) return read();
  const items = read();
  const index = items.findIndex(item => String(item.id) === String(product.id));
  if (index >= 0) {
    items[index].quantity += 1;
  } else {
    items.push({
      id: product.id,
      name: product.name || "商品",
      price: Number(product.price) || 0,
      img: product.img || "",
      quantity: 1
    });
  }
  write(items);
  return items;
}

function changeQuantity(id, delta) {
  const items = read();
  const index = items.findIndex(item => String(item.id) === String(id));
  if (index < 0) return items;
  items[index].quantity = Math.max(0, Number(items[index].quantity || 0) + Number(delta || 0));
  write(items);
  return read();
}

function summary(items = read()) {
  return items.reduce((total, item) => {
    total.quantity += Number(item.quantity) || 0;
    total.price += (Number(item.price) || 0) * (Number(item.quantity) || 0);
    return total;
  }, { quantity: 0, price: 0 });
}

module.exports = { read, add, changeQuantity, summary };
