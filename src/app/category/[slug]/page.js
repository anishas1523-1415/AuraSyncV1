import CategoryClient from "./CategoryClient";
import { CATEGORY_MAP } from "./categories";

// Pre-build every known category, so the bundled mobile app (static export) has all of them
export function generateStaticParams() {
  return Object.keys(CATEGORY_MAP).map((slug) => ({ slug }));
}

export default function CategoryPage({ params }) {
  return <CategoryClient slug={params.slug} />;
}
