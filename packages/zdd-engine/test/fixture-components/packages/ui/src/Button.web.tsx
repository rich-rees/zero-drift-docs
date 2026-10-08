import type { ButtonProps } from "./types";

// The web half of the shared button.
export function Button(props: ButtonProps) {
  return <button disabled={props.disabled} onClick={props.onPress}>{props.label}</button>;
}
