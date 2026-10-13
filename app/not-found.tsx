import Link from "next/link";
export default function NotFound() {
  return (
    <div className="wrap empty">
      <h1>A little off the beaten path.</h1>
      <p>We couldn’t find this page.</p>
      <Link className="button primary" href="/">
        Back to exploring
      </Link>
    </div>
  );
}
