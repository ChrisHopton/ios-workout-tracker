import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProvider } from "../data/store";
import { useTheme } from "../components/ui";
export default function RootLayout() {
  const t = useTheme();
  return (
    <AppProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: t.bg },
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="editor" options={{ title: "Workout plan" }} />
        <Stack.Screen name="record" options={{ title: "Record workout" }} />
      </Stack>
    </AppProvider>
  );
}
