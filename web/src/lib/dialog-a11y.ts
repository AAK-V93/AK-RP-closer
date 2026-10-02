import * as React from "react";

const TITLE_NAMES = new Set([
  "DialogTitle",
  "SheetTitle",
  "AlertDialogTitle",
  "DrawerTitle",
]);

const DESCRIPTION_NAMES = new Set([
  "DialogDescription",
  "SheetDescription",
  "AlertDialogDescription",
  "DrawerDescription",
]);

function componentName(type: unknown) {
  if (typeof type === "string" || type == null) return "";
  const named = type as { displayName?: string; name?: string };
  return named.displayName || named.name || "";
}

/** True when a Radix title or description is already somewhere in the tree. */
export function reactNodeHasComponent(node: React.ReactNode, names: ReadonlySet<string>): boolean {
  let found = false;
  const walk = (child: React.ReactNode) => {
    if (found || child == null || typeof child === "boolean") return;
    if (Array.isArray(child)) {
      for (const item of child) walk(item);
      return;
    }
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) {
      walk((child.props as { children?: React.ReactNode }).children);
      return;
    }
    if (names.has(componentName(child.type))) {
      found = true;
      return;
    }
    const props = child.props as { children?: React.ReactNode };
    if (props && typeof props === "object" && "children" in props) walk(props.children);
  };
  walk(node);
  return found;
}

export function missingDialogLabels(children: React.ReactNode) {
  return {
    title: !reactNodeHasComponent(children, TITLE_NAMES),
    description: !reactNodeHasComponent(children, DESCRIPTION_NAMES),
  };
}
