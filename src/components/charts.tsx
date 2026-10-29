import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from "react-native-svg";
import { Platform, View } from "react-native";
import { chartNumber } from "./analytics/selection";
import { useTheme, Txt } from "./ui";

const svgAccessibility = Platform.OS === "web" ? { "aria-hidden": true as const } : { accessible: false };

type ChartProps = { values: number[]; labels: string[]; description: string };

export function BarChart({ values, labels, description }: ChartProps) {
  const t = useTheme();
  const max = Math.max(1, ...values);
  const step = 264 / Math.max(1, values.length);
  return <View accessible accessibilityRole="image" accessibilityLabel={description}>
    <Svg {...svgAccessibility} width="100%" height={180} viewBox="0 0 320 180">
      {[0, 0.5, 1].map((fraction) => <Line key={fraction} x1="40" x2="312" y1={140 - fraction * 110} y2={140 - fraction * 110} stroke={t.border} />)}
      <SvgText x="34" y="34" fontSize="12" textAnchor="end" fill={t.muted}>{chartNumber(max, true)}</SvgText>
      <SvgText x="34" y="144" fontSize="12" textAnchor="end" fill={t.muted}>0</SvgText>
      {values.map((value, index) => <Rect key={index} x={44 + index * step} y={140 - value / max * 110}
        width={Math.max(4, step - 8)} height={value / max * 110} rx="3" fill={t.accent} />)}
      {labels.map((label, index) => (index === 0 || index === labels.length - 1 || (labels.length <= 4 || index === Math.floor(labels.length / 2))) &&
        <SvgText key={index} x={44 + index * step + (step - 8) / 2} y="164" textAnchor="middle" fontSize="12" fill={t.muted}>{label}</SvgText>)}
    </Svg>
  </View>;
}

export function LineChart({ values, labels, description }: ChartProps) {
  const t = useTheme();
  const max = Math.max(1, ...values);
  const x = (index: number) => values.length === 1 ? 176 : 44 + index * 262 / (values.length - 1);
  const y = (value: number) => 140 - value / max * 110;
  return <View accessible accessibilityRole="image" accessibilityLabel={description}>
    <Svg {...svgAccessibility} width="100%" height={180} viewBox="0 0 320 180">
      {[0, 0.5, 1].map((fraction) => <Line key={fraction} x1="40" x2="312" y1={140 - fraction * 110} y2={140 - fraction * 110} stroke={t.border} />)}
      <SvgText x="34" y="34" textAnchor="end" fontSize="12" fill={t.muted}>{chartNumber(max, true)}</SvgText>
      <SvgText x="34" y="144" textAnchor="end" fontSize="12" fill={t.muted}>0</SvgText>
      {values.length > 1 && <Polyline points={values.map((value, index) => `${x(index)},${y(value)}`).join(" ")}
        fill="none" stroke={t.accent} strokeWidth="3" strokeLinejoin="round" />}
      {values.map((value, index) => <Circle key={index} cx={x(index)} cy={y(value)} r="3.5" fill={t.accent} />)}
      {labels.length > 0 && <SvgText x={x(0)} y="164" textAnchor={labels.length === 1 ? "middle" : "start"} fontSize="12" fill={t.muted}>{labels[0]}</SvgText>}
      {labels.length > 1 && <SvgText x="306" y="164" textAnchor="end" fontSize="12" fill={t.muted}>{labels[labels.length - 1]}</SvgText>}
    </Svg>
  </View>;
}

export function HorizontalBarChart({ values, labels, description }: ChartProps) {
  const t = useTheme();
  const max = Math.max(1, ...values);
  return <View accessible accessibilityRole="image" accessibilityLabel={description} style={{ gap: 9 }}>
    {labels.map((label, index) => <View key={label} style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Txt style={{ fontSize: 13, lineHeight: 18 }}>{label}</Txt>
        <Txt bold style={{ fontSize: 13, lineHeight: 18 }}>{chartNumber(values[index], true)}</Txt>
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: t.accentSoft }}>
        <View style={{ height: 5, borderRadius: 3, width: `${values[index] / max * 100}%`, backgroundColor: t.accent }} />
      </View>
    </View>)}
  </View>;
}
