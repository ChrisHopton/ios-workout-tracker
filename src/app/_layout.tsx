import { Stack } from "expo-router";
import { AnalyticsProvider } from "../components/analytics/AnalyticsProvider";
import { StatusBar } from "expo-status-bar";
import { SyncProvider } from "../sync/provider";
import { AppProvider, useApp } from "../data/store";
import { isProfileComplete } from "../domain/profile";
import { ProfileOnboarding } from "../components/ProfileOnboarding";
import { useTheme } from "../components/ui";
export default function RootLayout() {
  return <AppProvider><StatusBar style="auto" /><ProfileGate /></AppProvider>;
}

function ProfileGate() {
  const { data } = useApp();
  if (!isProfileComplete(data)) return <ProfileOnboarding />;
  return <SyncProvider><AppNavigator /></SyncProvider>;
}

function AppNavigator() {
  const t = useTheme();
  return (
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
        <Stack.Screen name="plans" options={{ title: "Workout Plans" }} />
        <Stack.Screen name="editor" options={{ title: "Workout plan" }} />
        <Stack.Screen name="record" options={{ title: "Record workout" }} />
      </Stack>
    </AnalyticsProvider>
  );
}
