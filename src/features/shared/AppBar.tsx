import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getMyself } from "@/api/endpoints";
import { gemmaUrl } from "@/lib/gemmaConfig";

export function AppBar() {
  const me = useQuery({ queryKey: ["me"], queryFn: ({ signal }) => getMyself(signal) });
  const user = me.data;

  return (
    <header className="flex items-center gap-3 h-14 px-4 border-b border-gemma-grid bg-white">
      <Link to="/" className="flex items-center gap-2 font-semibold text-gemma-ink hover:no-underline">
        <span className="inline-block w-2 h-2 rounded-full bg-gemma-accent" />
        <span>Gemma Browser</span>
      </Link>

      <div className="flex-1" />

      <a
        href={gemmaUrl("/expressionExperiment/showAllExpressionExperiments.html")}
        className="text-sm text-gemma-subtle hover:text-gemma-ink hover:no-underline"
        target="_blank"
        rel="noreferrer"
      >
        Legacy browser
      </a>
      <a
        href="https://pavlidislab.github.io/Gemma/"
        className="text-sm text-gemma-subtle hover:text-gemma-ink hover:no-underline"
        target="_blank"
        rel="noreferrer"
      >
        Docs
      </a>

      {user ? (
        <div className="text-sm text-gemma-ink">
          <span className="text-gemma-subtle">Signed in as </span>
          <span className="font-medium">{user.userName}</span>
        </div>
      ) : null}
    </header>
  );
}
