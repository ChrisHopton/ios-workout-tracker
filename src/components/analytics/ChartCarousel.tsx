import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Card, useTheme } from "../ui";
import { ANALYTICS_CHARTS, carouselIndex, carouselLayout, CHART_GAP } from "./selection";

export function ChartCarousel({ index, onChange, children }: {
  index: number;
  onChange: (index: number) => void;
  children: ReactNode[];
}) {
  const t = useTheme();
  const scroll = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const selected = useRef(index);
  useLayoutEffect(() => { selected.current = index; }, [index]);
  const offset = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { cardWidth, interval, endPadding } = carouselLayout(width);
  const announce = useCallback((next: number) => {
    if (next === selected.current) return;
    selected.current = next;
    onChange(next);
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibilityWithOptions(
      `${ANALYTICS_CHARTS[next]}, chart ${next + 1} of ${ANALYTICS_CHARTS.length}`, { queue: true },
    );
  }, [onChange]);
  const settle = useCallback(() => {
    clearTimeout(timer.current);
    const next = carouselIndex(offset.current, interval);
    announce(next);
    if (Platform.OS === "web") scroll.current?.scrollTo({ x: next * interval, animated: false });
  }, [announce, interval]);

  useLayoutEffect(() => {
    clearTimeout(timer.current);
    offset.current = selected.current * interval;
    scroll.current?.scrollTo({ x: offset.current, animated: false });
  }, [interval]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function choose(next: number) {
    clearTimeout(timer.current);
    announce(next);
    offset.current = next * interval;
    scroll.current?.scrollTo({ x: offset.current, animated: false });
  }
  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    offset.current = event.nativeEvent.contentOffset.x;
    if (Platform.OS === "web") {
      clearTimeout(timer.current);
      timer.current = setTimeout(settle, 160);
    }
  }
  return <View style={{ gap: 2 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    {width > 0 && <ScrollView
      ref={scroll} horizontal showsHorizontalScrollIndicator={false}
      snapToInterval={interval} snapToAlignment="start" decelerationRate="fast" disableIntervalMomentum
      contentContainerStyle={{ gap: CHART_GAP, paddingRight: endPadding }}
      onScroll={onScroll} scrollEventThrottle={16}
      onScrollBeginDrag={() => clearTimeout(timer.current)}
      onScrollEndDrag={() => { timer.current = setTimeout(settle, 200); }}
      onMomentumScrollBegin={() => clearTimeout(timer.current)}
      onMomentumScrollEnd={(event) => { offset.current = event.nativeEvent.contentOffset.x; settle(); }}
    >
      {children.map((child, position) => <View key={ANALYTICS_CHARTS[position]}
        accessibilityElementsHidden={position !== index}
        importantForAccessibility={position === index ? "auto" : "no-hide-descendants"}
        aria-hidden={position !== index}
        style={{ width: cardWidth }}>
        <Card style={{ flex: 1, padding: 16 }}>{child}</Card>
      </View>)}
    </ScrollView>}
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
      {ANALYTICS_CHARTS.map((title, position) => <Pressable key={title}
        accessibilityRole="button"
        accessibilityLabel={`Show ${title}, chart ${position + 1} of ${ANALYTICS_CHARTS.length}`}
        accessibilityState={{ selected: position === index }}
        onPress={() => choose(position)}
        style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: position === index ? 18 : 7, height: 7, borderRadius: 4, backgroundColor: position === index ? t.accent : t.muted }} />
      </Pressable>)}
    </View>
    <Text accessibilityLiveRegion="polite" style={{ color: t.muted, fontSize: 12, textAlign: "center" }}>
      {index + 1} of {ANALYTICS_CHARTS.length} · {ANALYTICS_CHARTS[index]}
    </Text>
  </View>;
}
