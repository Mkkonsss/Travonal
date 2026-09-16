import Svg, { Circle, Path, Rect } from 'react-native-svg';

export function SuitcaseIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={8} width={18} height={13} rx={2} stroke={color} strokeWidth={1.8} fill="none" />
      <Path
        d="M8 8V5C8 3.9 8.9 3 10 3H14C15.1 3 16 3.9 16 5V8"
        stroke={color}
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function BoardsIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3} width={7.5} height={7.5} rx={2} stroke={color} strokeWidth={1.8} fill="none" />
      <Rect x={13.5} y={3} width={7.5} height={7.5} rx={2} stroke={color} strokeWidth={1.8} fill="none" />
      <Rect x={3} y={13.5} width={7.5} height={7.5} rx={2} stroke={color} strokeWidth={1.8} fill="none" />
      <Rect x={13.5} y={13.5} width={7.5} height={7.5} rx={2} stroke={color} strokeWidth={1.8} fill="none" />
    </Svg>
  );
}

export function HouseIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 10.5L12 3L21 10.5V20C21 20.55 20.55 21 20 21H4C3.45 21 3 20.55 3 20V10.5Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function BookingsIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Calendar body — open bottom-right, top connects to circle */}
      <Path
        d="M18 13.5V7.5C18 6.12 16.88 5 15.5 5H4.5C3.12 5 2 6.12 2 7.5V16.5C2 17.88 3.12 19 4.5 19H14.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        fill="none"
      />
      {/* Top rings */}
      <Path d="M7 3V6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M13 3V6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      {/* Horizontal divider */}
      <Path d="M2 9.5H18" stroke={color} strokeWidth={1.8} />
      {/* Checkmark circle badge */}
      <Circle cx={19} cy={18} r={4.5} stroke={color} strokeWidth={1.8} fill="none" />
      <Path d="M16.8 18L18.3 19.5L21.2 16.5" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

export function PersonIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={1.8} fill="none" />
      <Path
        d="M4 20A8 8 0 0 1 20 20"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}
