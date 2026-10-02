import Link from "next/link";

export default function NotFound() {
  return (
      <div className="wrap page">
        <h1>Page not found</h1>
        <p className="lead">
          That page does not exist. <Link prefetch={false} href="/">Back to the playground</Link> or <Link prefetch={false} href="/docs/">the docs</Link>.
        </p>
      </div>
  );
}
