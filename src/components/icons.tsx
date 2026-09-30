import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { SymbolView } from 'expo-symbols';

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
  return <SymbolView name="square.grid.2x2" size={size} tintColor={color} weight="light" />;
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
      <Rect x={3} y={4} width={18} height={17} rx={2} stroke={color} strokeWidth={1.3} fill="none" />
      <Path d="M3 9H21" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
      <Path d="M8 2V6" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
      <Path d="M16 2V6" stroke={color} strokeWidth={1.3} strokeLinecap="round" />
      <Path d="M9 15.5L11.5 18L16 13" stroke={color} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function LocationPinIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2C8.13 2 5 5.13 5 9C5 14.25 12 22 12 22C12 22 19 14.25 19 9C19 5.13 15.87 2 12 2Z"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Circle cx={12} cy={9} r={2.5} stroke={color} strokeWidth={1.3} fill="none" />
    </Svg>
  );
}

export function JoinTripIcon({ size, color }: { size: number; color: string }) {
  return <SymbolView name="person.badge.plus" size={size} tintColor={color} />;
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
