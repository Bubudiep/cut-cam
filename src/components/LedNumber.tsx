import type { CSSProperties } from 'react'
import { CELL_HEIGHT, CELL_WIDTH, SLANT_MARGIN } from './ledGeometry'

// Chữ số kiểu đèn LED 7 đoạn, vẽ bằng SVG: không phụ thuộc phông chữ nào, và co giãn theo khung chứa.

/** Nửa bề dày của một đoạn. */
const HALF = 5.2
/** Khe hở giữa hai đoạn kề nhau. */
const GAP = 1.4
const LEFT = 11
const RIGHT = 45
const TOP = 10
const MIDDLE = 50
const BOTTOM = 90

/** Đoạn nằm ngang, hai đầu vát nhọn. */
const horizontal = (y: number) => {
  const [a, b] = [LEFT + GAP, RIGHT - GAP]
  return `${a},${y} ${a + HALF},${y - HALF} ${b - HALF},${y - HALF} ${b},${y} ${b - HALF},${y + HALF} ${a + HALF},${y + HALF}`
}

/** Đoạn thẳng đứng, hai đầu vát nhọn. */
const vertical = (x: number, from: number, to: number) => {
  const [a, b] = [from + GAP, to - GAP]
  return `${x},${a} ${x + HALF},${a + HALF} ${x + HALF},${b - HALF} ${x},${b} ${x - HALF},${b - HALF} ${x - HALF},${a + HALF}`
}

// Tên đoạn theo quy ước chung: a trên cùng, rồi theo chiều kim đồng hồ b, c, d, e, f; g ở giữa.
const SEGMENTS: Record<string, string> = {
  a: horizontal(TOP),
  b: vertical(RIGHT, TOP, MIDDLE),
  c: vertical(RIGHT, MIDDLE, BOTTOM),
  d: horizontal(BOTTOM),
  e: vertical(LEFT, MIDDLE, BOTTOM),
  f: vertical(LEFT, TOP, MIDDLE),
  g: horizontal(MIDDLE),
}

const LIT: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
}

interface TextProps {
  /** Dãy chữ số (và dấu trừ) cần hiện; ký tự khác thành ô trống. */
  text: string
  /** Màu đèn khi sáng. */
  color: string
  /** Bán kính quầng sáng quanh đèn, vd. `0.5vw`. Bỏ trống thì không có quầng. */
  glow?: string
  className?: string
  style?: CSSProperties
}

/** Hiện một dãy chữ số bằng đèn LED 7 đoạn; các đoạn tắt vẫn thấy mờ mờ như trên bảng đèn thật. */
export function LedText({ text, color, glow, className, style }: TextProps) {
  const chars = [...text]
  const width = chars.length * CELL_WIDTH

  return (
    <svg
      className={className}
      style={{ ...style, ...(glow ? { filter: `drop-shadow(0 0 ${glow} ${color})` } : undefined) }}
      viewBox={`${-SLANT_MARGIN} 0 ${width + SLANT_MARGIN * 2} ${CELL_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={text}
    >
      {/* Xô nghiêng nhẹ quanh tâm, kiểu chữ số của đồng hồ điện tử. */}
      <g transform={`translate(${(CELL_HEIGHT / 2) * 0.09} 0) skewX(-5)`}>
        {chars.map((char, index) => {
          const on = LIT[char] ?? ''
          return (
            <g key={index} transform={`translate(${index * CELL_WIDTH} 0)`}>
              {Object.entries(SEGMENTS).map(([name, points]) => {
                const lit = on.includes(name)
                return <polygon key={name} points={points} fill={lit ? color : '#ffffff'} opacity={lit ? 1 : 0.045} />
              })}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

interface Props extends Omit<TextProps, 'text'> {
  value: number
  /** Số ô tối thiểu. Số ngắn hơn thì canh phải, các ô thừa để tắt như đồng hồ LED thật. */
  cells?: number
}

/** Hiện một số nguyên bằng đèn LED 7 đoạn. */
export function LedNumber({ value, cells = 2, ...rest }: Props) {
  return <LedText text={String(Math.round(value)).padStart(cells, ' ')} {...rest} />
}
