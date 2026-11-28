import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { generateQrMatrix } from '../utils/qrMatrix';

interface QrCodeViewProps {
  value: string;
  size?: number;
}

export function QrCodeView({ value, size = 188 }: QrCodeViewProps) {
  const matrix = useMemo(() => {
    try {
      return generateQrMatrix(value);
    } catch {
      return [];
    }
  }, [value]);

  const count = matrix.length;
  const moduleSize = count > 0 ? Math.max(3, Math.floor(size / count)) : 4;
  const innerSize = count > 0 ? count * moduleSize : size;

  return (
    <View style={[styles.frame, { width: innerSize + 24, height: innerSize + 24 }]}>
      <View style={{ width: innerSize, height: innerSize, backgroundColor: '#FFFFFF' }}>
        {matrix.map((row, rIdx) => (
          <View key={rIdx} style={{ flexDirection: 'row', height: moduleSize }}>
            {row.map((dark, cIdx) => (
              <View
                key={cIdx}
                style={{
                  width: moduleSize,
                  height: moduleSize,
                  backgroundColor: dark ? '#000000' : '#FFFFFF',
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.96)',
  },
});
