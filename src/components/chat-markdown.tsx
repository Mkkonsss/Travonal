import { Fragment } from 'react';
import { Linking, Text, View, StyleSheet } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

/**
 * Lightweight markdown renderer for chat messages.
 * Supports: **bold**, *italic*, bullet lists (- / *), numbered lists, line breaks.
 * No npm dependency — just regex parsing into React Native Text elements.
 */

interface ChatMarkdownProps {
  text: string;
  isUser?: boolean;
}

// Parse inline formatting: **bold**, *italic*, and URLs
function renderInline(line: string, isUser: boolean, theme: ReturnType<typeof useTheme>, keyPrefix: string) {
  const parts: React.ReactNode[] = [];
  // Match **bold**, *italic*, or URLs
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(https?:\/\/[^\s)]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = regex.exec(line)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // **bold**
      parts.push(
        <Text key={`${keyPrefix}-b${i}`} style={mdStyles.bold}>{match[2]}</Text>
      );
    } else if (match[4]) {
      // *italic*
      parts.push(
        <Text key={`${keyPrefix}-i${i}`} style={mdStyles.italic}>{match[4]}</Text>
      );
    } else if (match[5]) {
      // URL
      const url = match[5];
      parts.push(
        <Text
          key={`${keyPrefix}-u${i}`}
          style={[mdStyles.link, isUser && { color: 'rgba(255,255,255,0.85)' }]}
          onPress={() => Linking.openURL(url)}
        >
          {url}
        </Text>
      );
    }

    lastIndex = match.index + match[0].length;
    i++;
  }

  // Remaining text
  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [line];
}

export function ChatMarkdown({ text, isUser = false }: ChatMarkdownProps) {
  const theme = useTheme();
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    // Bullet list: starts with "- " or "* " (but not "**")
    const bulletMatch = line.match(/^[\s]*[-*]\s+(.+)/);
    if (bulletMatch && !line.trimStart().startsWith('**')) {
      elements.push(
        <View key={key++} style={mdStyles.listItem}>
          <Text style={[mdStyles.bullet, isUser && { color: 'rgba(255,255,255,0.7)' }, !isUser && { color: theme.textSecondary }]}>
            {'\u2022'}
          </Text>
          <Text style={[mdStyles.listText, isUser && { color: '#fff' }]}>
            {renderInline(bulletMatch[1], isUser, theme, `l${li}`)}
          </Text>
        </View>
      );
      continue;
    }

    // Numbered list: starts with "1. ", "2. ", etc.
    const numMatch = line.match(/^[\s]*(\d+)\.\s+(.+)/);
    if (numMatch) {
      elements.push(
        <View key={key++} style={mdStyles.listItem}>
          <Text style={[mdStyles.numBullet, isUser && { color: 'rgba(255,255,255,0.7)' }, !isUser && { color: theme.textSecondary }]}>
            {numMatch[1]}.
          </Text>
          <Text style={[mdStyles.listText, isUser && { color: '#fff' }]}>
            {renderInline(numMatch[2], isUser, theme, `l${li}`)}
          </Text>
        </View>
      );
      continue;
    }

    // Empty line = spacing
    if (line.trim() === '') {
      elements.push(<View key={key++} style={mdStyles.spacer} />);
      continue;
    }

    // Regular text
    elements.push(
      <Text key={key++} style={[mdStyles.text, isUser && { color: '#fff' }]}>
        {renderInline(line, isUser, theme, `l${li}`)}
      </Text>
    );
  }

  return <Fragment>{elements}</Fragment>;
}

const mdStyles = StyleSheet.create({
  text: {
    fontSize: 15,
    lineHeight: 22,
  },
  bold: {
    fontWeight: '700',
  },
  italic: {
    fontStyle: 'italic',
  },
  link: {
    textDecorationLine: 'underline',
    color: '#3B82F6',
  },
  listItem: {
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 4,
    marginTop: 2,
  },
  bullet: {
    fontSize: 15,
    lineHeight: 22,
    width: 12,
  },
  numBullet: {
    fontSize: 15,
    lineHeight: 22,
    width: 18,
    textAlign: 'right',
  },
  listText: {
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  spacer: {
    height: 8,
  },
});
