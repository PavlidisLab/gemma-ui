import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="p-8">
      <h2 className="text-lg mb-2">Page not found</h2>
      <p className="text-sm text-gemma-subtle">
        That URL didn't match any known route.{" "}
        <Link to="/" className="text-gemma-accent">
          Back to browser
        </Link>
      </p>
    </div>
  );
}
