// Kích thước một ô đèn LED 7 đoạn trong hệ toạ độ của SVG.
export const CELL_WIDTH = 56
export const CELL_HEIGHT = 100
/** Chừa lề hai bên cho phần bị xô nghiêng. */
export const SLANT_MARGIN = 5

/** Tỉ lệ rộng/cao của một dãy `count` ô đèn, để nơi dùng tính trước được bề ngang. */
export const ledAspect = (count: number) => (count * CELL_WIDTH + SLANT_MARGIN * 2) / CELL_HEIGHT
