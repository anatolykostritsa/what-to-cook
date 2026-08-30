"use client";

type Product = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  expiry_date: string | null;
};

type Recipe = {
  name: string;
  time: number;
  servings: number;
  ingredients: string[];
};

const RECIPES: Recipe[] = [
  {
    name: "Паста с курицей и сливочным соусом",
    time: 25,
    servings: 2,
    ingredients: [
      "курица",
      "макароны",
      "сливки",
      "сыр",
      "лук",
    ],
  },

  {
    name: "Омлет с овощами и сыром",
    time: 12,
    servings: 2,
    ingredients: [
      "яйца",
      "сыр",
      "помидоры",
      "лук",
    ],
  },

  {
    name: "Паста с томатами и сыром",
    time: 20,
    servings: 2,
    ingredients: [
      "макароны",
      "помидоры",
      "сыр",
      "лук",
    ],
  },

  {
    name: "Курица в сливочном соусе",
    time: 25,
    servings: 2,
    ingredients: [
      "курица",
      "сливки",
      "лук",
      "чеснок",
    ],
  },

  {
    name: "Яичница с помидорами",
    time: 10,
    servings: 2,
    ingredients: [
      "яйца",
      "помидоры",
    ],
  },

  {
    name: "Курица с макаронами",
    time: 20,
    servings: 2,
    ingredients: [
      "курица",
      "макароны",
      "лук",
    ],
  },

  {
    name: "Сырный омлет",
    time: 10,
    servings: 2,
    ingredients: [
      "яйца",
      "сыр",
    ],
  },
];

function normalize(text: string) {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .trim();
}

function productMatches(
  product: string,
  ingredient: string
) {
  const p = normalize(product);
  const i = normalize(ingredient);

  if (p.includes(i) || i.includes(p)) {
    return true;
  }

  const aliases: Record<string, string[]> = {
    макароны: [
      "паста",
      "спагетти",
      "лапша",
    ],

    курица: [
      "куриное филе",
      "куриная грудка",
      "куриные грудки",
    ],

    яйца: [
      "яйцо",
    ],

    сыр: [
      "моцарелла",
      "чеддер",
      "пармезан",
    ],

    помидоры: [
      "помидор",
      "томаты",
      "томат",
    ],

    лук: [
      "репчатый лук",
    ],

    сливки: [
      "сливки 10%",
      "сливки 20%",
      "сливки 30%",
    ],
  };

  const alternatives = aliases[i] ?? [];

  return alternatives.some(
    (alias) =>
      p.includes(alias) ||
      alias.includes(p)
  );
}

function calculateScore(
  recipe: Recipe,
  products: Product[]
) {
  let matched = 0;

  const missing: string[] = [];

  for (const ingredient of recipe.ingredients) {
    const exists = products.some((product) =>
      productMatches(product.name, ingredient)
    );

    if (exists) {
      matched++;
    } else {
      missing.push(ingredient);
    }
  }

  const ingredientScore =
    (matched / recipe.ingredients.length) * 80;

  /*
   * Дополнительный бонус:
   * продукты, которые скоро испортятся,
   * немного поднимают блюдо в выдаче.
   */

  let expiryBonus = 0;

  for (const product of products) {
    if (!product.expiry_date) continue;

    const today = new Date();

    const expiry = new Date(
      `${product.expiry_date}T00:00:00`
    );

    const days =
      Math.ceil(
        (expiry.getTime() - today.getTime()) /
          (1000 * 60 * 60 * 24)
      );

    if (days <= 2) {
      expiryBonus += 5;
    }
  }

  expiryBonus = Math.min(
    expiryBonus,
    20
  );

  const score = Math.min(
    100,
    Math.round(
      ingredientScore + expiryBonus
    )
  );

  return {
    ...recipe,
    score,
    matched,
    missing,
  };
}

export default function RecipeSuggestions({
  products,
}: {
  products: Product[];
  householdId: string;
}) {
  if (!products.length) {
    return (
      <div className="empty-state">
        Сначала добавьте продукты.
        <br />
        Тогда мы сможем подобрать блюда.
      </div>
    );
  }

  const suggestions = RECIPES
    .map((recipe) =>
      calculateScore(recipe, products)
    )
    .filter((recipe) => recipe.score >= 35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return (
    <div className="recipe-grid">
      {suggestions.map((recipe) => (
        <article
          className="recipe-card"
          key={recipe.name}
        >
          <div className="recipe-score">
            {recipe.score}%
          </div>

          <h3>{recipe.name}</h3>

          <div className="recipe-meta">
            ⏱ {recipe.time} мин · 👥{" "}
            {recipe.servings}
          </div>

          <div className="recipe-ingredients">
            {recipe.ingredients.map(
              (ingredient) => {
                const available =
                  products.some((product) =>
                    productMatches(
                      product.name,
                      ingredient
                    )
                  );

                return (
                  <span
                    key={ingredient}
                    className={
                      available
                        ? "ingredient available"
                        : "ingredient missing"
                    }
                  >
                    {available ? "✓" : "+"}{" "}
                    {ingredient}
                  </span>
                );
              }
            )}
          </div>

          {recipe.missing.length > 0 && (
            <p className="recipe-missing">
              Не хватает:{" "}
              {recipe.missing.join(", ")}
            </p>
          )}

          {recipe.missing.length === 0 && (
            <p className="recipe-perfect">
              🎉 Всё необходимое уже есть дома
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
