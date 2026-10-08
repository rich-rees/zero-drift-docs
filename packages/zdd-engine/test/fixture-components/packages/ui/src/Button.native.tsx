import { Pressable, Text } from "react-native";
import type { ButtonProps } from "./types";

// The native half of the shared button.
export function Button(props: ButtonProps) {
  return (
    <Pressable disabled={props.disabled} onPress={props.onPress}>
      <Text>{props.label}</Text>
    </Pressable>
  );
}
