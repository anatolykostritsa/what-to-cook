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
  if (!date) return "Без срока годности";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${date}T00:00:00`);
  const diff = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "⚠️ Срок истёк";
  if (diff === 0) return "🔥 Использовать сегодня";
  if (diff === 1) return "⏰ Использовать завтра";
  if (diff <= 3) return `⏰ Осталось ${diff} дн.`;
  return `Осталось ${diff} дн.`;
}

export default function ProductList({
  products,
  onDelete,
  onEdit,
}: {
  products: Product[];
  onDelete: (id: string) => void;
  onEdit: (product: Product) => void;
}) {
  if (!products.length) {
    return <div className="empty-state">Пока продуктов нет.<br />Добавьте то, что сейчас лежит дома.</div>;
  }

  return (
    <div className="item-list">
      {products.map((product) => (
        <div className="product-item" key={product.id}>
          <div className="product-main">
            <strong>{product.name}</strong>
            <span className="muted">{product.quantity !== null ? `${product.quantity} ${product.unit ?? ""}`.trim() : "Количество не указано"}</span>
          </div>
          <div className="product-expiry">{getExpiryText(product.expiry_date)}</div>
          <div className="product-actions">
            <button className="icon-button" onClick={() => onEdit(product)} aria-label={`Изменить ${product.name}`}>✎</button>
            <button className="delete-button" onClick={() => onDelete(product.id)} aria-label={`Удалить ${product.name}`}>×</button>
          </div>
        </div>
      ))}
    </div>
  );
}
