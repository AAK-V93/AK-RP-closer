function Bone({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-bg2 ${className}`} />;
}

export function HomeSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando inicio">
      <Bone className="h-10 w-2/3" />
      <Bone className="h-4 w-full" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Bone className="h-24" />
        <Bone className="h-24" />
        <Bone className="h-24" />
        <Bone className="h-24" />
      </div>
      <Bone className="h-40" />
    </div>
  );
}

export function WorkspaceSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando tu espacio">
      <Bone className="h-10 w-40" />
      <Bone className="h-4 w-full" />
      <Bone className="h-28" />
      <Bone className="h-28" />
    </div>
  );
}
