import { Stack } from "expo-router";
import { AnalyticsProvider } from "../components/analytics/AnalyticsProvider";
import { StatusBar } from "expo-status-bar";
import { SyncProvider } from "../sync/provider";
import { AppProvider } from "../data/store";
import { useTheme } from "../components/ui";
export default function RootLayout() {
  const t = useTheme();
  return (
    <AppProvider>
      <SyncProvider>
        <StatusBar style="auto" />
        <AnalyticsProvider>
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
          <Stack.Screen name="analytics-exercises" options={{ title: "Exercises" }} />
          <Stack.Screen name="analytics-exercise" options={{ title: "Exercise progress" }} />
          <Stack.Screen name="analytics-training" options={{ title: "Training details" }} />
          <Stack.Screen name="analytics-comparisons" options={{ title: "Comparisons" }} />
          <Stack.Screen name="plans" options={{ title: "Workout Plans" }} />
          <Stack.Screen name="editor" options={{ title: "Workout plan" }} />
          <Stack.Screen name="record" options={{ title: "Record workout" }} />
        </Stack>
        </AnalyticsProvider>
      </SyncProvider>
    </AppProvider>
  );
}
