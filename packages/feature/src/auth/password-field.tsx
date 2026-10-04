import { useMessages } from "../i18n/index.js";
import { PasswordInput, type PasswordInputProps } from "../import.js";

// The shared password control with its copy: every password field in the app is this one,
// so the toggle is announced the same way everywhere.
export function PasswordField(props: Omit<PasswordInputProps, "showLabel" | "hideLabel">) {
  const { t } = useMessages("common");
  return <PasswordInput showLabel={t("password.show")} hideLabel={t("password.hide")} {...props} />;
}
