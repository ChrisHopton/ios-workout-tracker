import Svg, {
  Circle,
  Line,
  Polyline,
  Rect,
  Text as SvgText,
} from "react-native-svg";
import { View } from "react-native";
import { useTheme, Txt } from "./ui";
import { ChartReference, chartScale } from "./chartReference";
export function BarChart({
  values,
  labels,
  description,
}: {
  values: number[];
  labels: string[];
  description: string;
}) {
  const t = useTheme();
  const max = Math.max(1, ...values);
  const step = 280 / Math.max(1, values.length);
  return (
    <View
      accessible
      accessibilityLabel={
        description +
        ": " +
        values.map((v, i) => labels[i] + " " + v).join(", ")
      }
    >
      <Svg width="100%" height={180} viewBox="0 0 320 180">
        {[0, 0.5, 1].map((f) => (
          <Line
            key={f}
            x1="28"
            x2="312"
            y1={140 - f * 115}
            y2={140 - f * 115}
            stroke={t.border}
          />
        ))}
        <SvgText x="22" y="29" fontSize="10" textAnchor="end" fill={t.muted}>
          {max}
        </SvgText>
        <SvgText x="22" y="143" fontSize="10" textAnchor="end" fill={t.muted}>
          0
        </SvgText>
        {values.map((v, i) => (
          <Rect
            key={i}
            x={32 + i * step}
            y={140 - (v / max) * 115}
            width={Math.max(4, step - 9)}
            height={(v / max) * 115}
            rx="4"
            fill={t.accent}
          />
        ))}
        {labels.map(
          (label, i) =>
            (labels.length <= 8 || i % 2 === 0 || i === labels.length - 1) && (
              <SvgText
                key={i}
                x={32 + i * step + (step - 9) / 2}
                y="163"
                textAnchor="middle"
                fontSize="9"
                fill={t.muted}
              >
                {label}
              </SvgText>
            ),
        )}
      </Svg>
    </View>
  );
}
export function LineChart({
  values,
  labels,
  description,
  referenceLine,
}: {
  values: number[];
  labels: string[];
  description: string;
  referenceLine?: ChartReference;
}) {
  const t = useTheme();
  const { max, reference } = chartScale(values, referenceLine);
  const x = (i: number) =>
    values.length === 1 ? 170 : 36 + (i * 270) / (values.length - 1);
  const y = (v: number) => 135 - (v / max) * 108;
  const points = values.map((v, i) => x(i) + "," + y(v)).join(" ");
  return (
    <View
      accessible
      accessibilityLabel={
        description +
        ": " +
        values.map((v, i) => labels[i] + " " + v).join(", ") +
        (reference ? ". Reference: " + reference.label : "")
      }
    >
      <Svg width="100%" height={180} viewBox="0 0 320 180">
        {[0, 0.5, 1].map((f) => (
          <Line
            key={f}
            x1="30"
            x2="312"
            y1={135 - f * 108}
            y2={135 - f * 108}
            stroke={t.border}
          />
        ))}
        <SvgText x="24" y="30" textAnchor="end" fontSize="10" fill={t.muted}>
          {Math.round(max * 10) / 10}
        </SvgText>
        {reference && <Line x1="30" x2="312" y1={y(reference.value)} y2={y(reference.value)} stroke={t.muted} strokeWidth="2" strokeDasharray="6 4" />}
        {values.length > 1 && (
          <Polyline
            points={points}
            fill="none"
            stroke={t.accent}
            strokeWidth="3"
            strokeLinejoin="round"
          />
        )}
        {values.map((v, i) => (
          <Circle key={i} cx={x(i)} cy={y(v)} r="4" fill={t.accent} />
        ))}
        {labels.length > 0 && (
          <>
            <SvgText
              x={values.length === 1 ? 170 : 36}
              y="162"
              textAnchor={values.length === 1 ? "middle" : "start"}
              fontSize="10"
              fill={t.muted}
            >
              {labels[0]}
            </SvgText>
            {labels.length > 1 && (
              <SvgText
                x="306"
                y="162"
                textAnchor="end"
                fontSize="10"
                fill={t.muted}
              >
                {labels[labels.length - 1]}
              </SvgText>
            )}
          </>
        )}
      </Svg>
      {reference && <Txt muted style={{ fontSize: 12 }}>┄ {reference.label}</Txt>}
    </View>
  );
}
