"use client";

type ShoppingItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  done: boolean;
};

export default function ShoppingList({
  items,
  onToggle,
  onDelete,
}: {
  items: ShoppingItem[];
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
}) {
  if (!items.length) {
    return (
      <div className="empty-state">
        Список покупок пуст.
      </div>
    );
  }

  const active = items.filter((x) => !x.done);
  const completed = items.filter((x) => x.done);

  return (
    <div className="shopping-list">
      {active.map((item) => (
        <ShoppingRow
          key={item.id}
          item={item}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}

      {completed.length > 0 && (
        <>
          <div className="completed-label">
            Куплено
          </div>

          {completed.map((item) => (
            <ShoppingRow
              key={item.id}
              item={item}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ))}
        </>
      )}
    </div>
  );
}

function ShoppingRow({
  item,
  onToggle,
  onDelete,
}: {
  item: ShoppingItem;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className={`shopping-item ${
        item.done ? "shopping-done" : ""
      }`}
    >
      <button
        className="check-button"
        onClick={() => onToggle(item.id, item.done)}
      >
        {item.done ? "✓" : ""}
      </button>

      <div className="shopping-name">
        {item.name}

        {item.quantity !== null && (
          <span className="muted">
            {" "}
            · {item.quantity} {item.unit ?? ""}
          </span>
        )}
      </div>

      <button
        className="delete-button"
        onClick={() => onDelete(item.id)}
      >
        ×
      </button>
    </div>
  );
}
