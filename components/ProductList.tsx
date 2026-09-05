"use client";

type Product = { id: string; name: string; quantity: number | null; unit: string | null; category: string | null; expiry_date: string | null; ingredient_id: string | null; ingredient_match_group?: string | null; ingredient_family_key?: string | null };

function getExpiryState(date: string | null) {
  if (!date) return { text: "Без срока", className: "expiry-normal" };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${date}T00:00:00`);
  const diff = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { text: "Срок истёк", className: "expiry-danger" };
  if (diff === 0) return { text: "Сегодня", className: "expiry-danger" };
  if (diff === 1) return { text: "Завтра", className: "expiry-warning" };
  if (diff <= 3) return { text: `${diff} дн.`, className: "expiry-warning" };
  return { text: `${diff} дн.`, className: "expiry-normal" };
}

export default function ProductList({ products, onDelete, onEdit }: { products: Product[]; onDelete: (id: string) => void; onEdit: (product: Product) => void }) {
  if (!products.length) return <div className="empty-state">Пока продуктов нет.<br />Добавьте то, что сейчас лежит дома.</div>;
  return <div className="item-list">
    {products.map((product) => {
      const expiry = getExpiryState(product.expiry_date);
      return <div className="product-item" key={product.id}>
        <div className="product-main"><strong>{product.name}</strong><span className="muted">{product.quantity !== null ? `${product.quantity} ${product.unit ?? ""}`.trim() : "Количество не указано"}{product.category ? ` · ${product.category}` : ""}</span></div>
        <span className={`product-expiry ${expiry.className}`}>{expiry.text}</span>
        <div className="product-actions"><button className="icon-button" onClick={() => onEdit(product)} aria-label={`Редактировать ${product.name}`}>✎</button><button className="delete-button" onClick={() => onDelete(product.id)} aria-label={`Удалить ${product.name}`}>×</button></div>
      </div>;
    })}
  </div>;
}
