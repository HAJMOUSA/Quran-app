import { Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { t } from "../../i18n";

export default function SearchScreen() {
  return (
    <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>{t("tab.search")}</Text>
    </SafeAreaView>
  );
}
