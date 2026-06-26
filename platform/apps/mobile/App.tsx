import { useEffect, useState } from "react";
import { Text, View, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { emptyDraft } from "./src/capture-draft-smoke";

export default function App() {
  const [launchedForCapture, setLaunchedForCapture] = useState(false);

  useEffect(() => {
    // Cold start: did the widget launch us via bridge://capture ?
    Linking.getInitialURL().then((url) => {
      if (url && url.includes("capture")) setLaunchedForCapture(true);
    });
    // Warm: widget tapped while app is open.
    const sub = Linking.addEventListener("url", ({ url }) => {
      if (url.includes("capture")) setLaunchedForCapture(true);
    });
    return () => sub.remove();
  }, []);

  // Touch the smoke export so the type-only import is retained in the build graph.
  const draftId = emptyDraft("dummy_boot", "dummy_ws").id;

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Bridge Capture</Text>
      <Text style={styles.subtitle}>
        {launchedForCapture ? "Capture screen (Plan 05 lands here)" : `shell ready · ${draftId}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 24, fontWeight: "600" },
  subtitle: { fontSize: 14, opacity: 0.7, marginTop: 8 },
});
