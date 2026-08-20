import styles from "./Sparkline.module.css";

const WIDTH = 62;
const HEIGHT = 20;

export default function Sparkline({ points = [], tone = "sky" }) {
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = WIDTH / (points.length - 1);

  const polyline = points
    .map((point, index) => {
      const x = index * step;
      const y = HEIGHT - ((point - min) / span) * HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className={`${styles.line} ${styles[tone]}`}
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
    >
      <polyline
        points={polyline}
        fill="none"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
