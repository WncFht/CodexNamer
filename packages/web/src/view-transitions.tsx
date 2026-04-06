import * as React from "react";

type TransitionClass = "none" | "auto" | string | Record<string, "none" | "auto" | string>;

type NativeViewTransitionProps = React.PropsWithChildren<{
  className?: string;
  default?: TransitionClass;
  enter?: TransitionClass;
  exit?: TransitionClass;
  name?: string;
  share?: TransitionClass;
  update?: TransitionClass;
}>;

type ReactWithViewTransition = typeof React & {
  ViewTransition?: React.ComponentType<NativeViewTransitionProps>;
  addTransitionType?: (type: string) => void;
};

const reactWithViewTransition = React as ReactWithViewTransition;

export function addAppTransitionType(type: string): void {
  reactWithViewTransition.addTransitionType?.(type);
}

export function AppViewTransition(props: NativeViewTransitionProps) {
  const NativeViewTransition = reactWithViewTransition.ViewTransition;
  if (!NativeViewTransition) {
    return <>{props.children}</>;
  }
  return <NativeViewTransition {...props} />;
}
