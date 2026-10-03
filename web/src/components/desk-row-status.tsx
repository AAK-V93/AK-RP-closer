import React from "react";
import { mobileDeskStatus } from "@/lib/visible-text";

/** Phone copy carries an explicit «…». Wider screens keep the full line and may clamp. */
export function DeskRowStatus({ status }: { status: string }) {
  const mobile = mobileDeskStatus(status);
  return (
    <div className="min-w-0 flex-1 text-sm text-fg3">
      <p className="sm:hidden" title={status}>
        {mobile}
      </p>
      <p className="hidden text-left sm:line-clamp-2" title={status}>
        {status}
      </p>
    </div>
  );
}
