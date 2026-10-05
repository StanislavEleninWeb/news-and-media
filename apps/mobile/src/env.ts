import Constants from 'expo-constants';

interface Extra {
  variant?: 'development' | 'staging' | 'production';
  apiUrl?: string;
  stagingKey?: string;
  eas?: { projectId?: string };
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const env = {
  variant: extra.variant ?? 'development',
  apiUrl: extra.apiUrl ?? 'http://localhost:3000',
  stagingKey: extra.stagingKey,
  projectId: extra.eas?.projectId ?? Constants.easConfig?.projectId,
};
