"use client";

type Product = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  category: string | null;
  expiry_date: string | null;
};

function getExpiryText(date: string | null) {
  if (!date) {
    return "Без срока годности";
  }

  const today = new Date();

  today.setHours(0, 0, 0, 0);

  const expiry = new Date(`${date}T00:00:00`);

  const diff =
    Math.ceil(
      (expiry.getTime() - today.getTime()) /
        (1000 * 60 * 60 * 24)
    );

  if (diff < 0) {
    return "⚠️ Срок истёк";
  }

  if (diff === 0) {
    return "🔥 Использовать сегодня";
  }

  if (diff === 1) {
    return "⏰ Использовать завтра";
  }

  if (diff <= 3) {
    return `⏰ Осталось ${diff} дн.`;
  }

  return `Осталось ${diff} дн.`;
}

export default function ProductList({
  products,
  onDelete,
}: {
  products: Product[];
  onDelete: (id: string) => void;
}) {
  if (!products.length) {
    return (
      <div className="empty-state">
        Пока продуктов нет.
        <br />
        Добавьте то, что сейчас лежит дома.
      </div>
    );
  }

  return (
    <div className="item-list">
      {products.map((product) => (
        <div className="product-item" key={product.id}>
          <div className="product-main">
            <strong>{product.name}</strong>

            <span className="muted">
              {product.quantity !== null
                ? `${product.quantity} ${product.unit ?? ""}`
                : ""}
            </span>
          </div>

          <div className="product-expiry">
            {getExpiryText(product.expiry_date)}
          </div>

          <button
            className="delete-button"
            onClick={() => onDelete(product.id)}
            aria-label="Удалить продукт"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
