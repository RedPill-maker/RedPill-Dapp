import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface Video {
  id: string
  title: string
  channel: string
  views: string
  timestamp: string
  duration: string
  thumbnail: string
  channelAvatar: string
}

export interface VideoState {
  videos: Video[]
  searchQuery: string
}

const mockVideos: Video[] = [
  {
    id: '1',
    title: 'React Redux Complete Tutorial - From Beginner to Expert',
    channel: 'Tech Learning',
    views: '1.25M',
    timestamp: '2 days ago',
    duration: '15:30',
    thumbnail: 'https://picsum.photos/320/180?random=1',
    channelAvatar: 'https://picsum.photos/36/36?random=11',
  },
  {
    id: '2',
    title: 'Tailwind CSS Practical Project - Building Modern UI',
    channel: 'UI Design Pro',
    views: '890K',
    timestamp: '1 week ago',
    duration: '22:45',
    thumbnail: 'https://picsum.photos/320/180?random=2',
    channelAvatar: 'https://picsum.photos/36/36?random=12',
  },
  {
    id: '3',
    title: 'TypeScript Advanced Features Explained',
    channel: 'Code Master',
    views: '670K',
    timestamp: '3 days ago',
    duration: '18:20',
    thumbnail: 'https://picsum.photos/320/180?random=3',
    channelAvatar: 'https://picsum.photos/36/36?random=13',
  },
  {
    id: '4',
    title: 'Vite Build Tool Complete Guide',
    channel: 'Dev Tools',
    views: '450K',
    timestamp: '5 days ago',
    duration: '12:15',
    thumbnail: 'https://picsum.photos/320/180?random=4',
    channelAvatar: 'https://picsum.photos/36/36?random=14',
  },
  {
    id: '5',
    title: 'Frontend Performance Optimization Best Practices',
    channel: 'Performance Hub',
    views: '1.56M',
    timestamp: '1 day ago',
    duration: '25:40',
    thumbnail: 'https://picsum.photos/320/180?random=5',
    channelAvatar: 'https://picsum.photos/36/36?random=15',
  },
  {
    id: '6',
    title: 'JavaScript ES2024 New Features',
    channel: 'JS Weekly',
    views: '780K',
    timestamp: '4 days ago',
    duration: '16:55',
    thumbnail: 'https://picsum.photos/320/180?random=6',
    channelAvatar: 'https://picsum.photos/36/36?random=16',
  },
]

const initialState: VideoState = {
  videos: mockVideos,
  searchQuery: '',
}

const videoSlice = createSlice({
  name: 'videos',
  initialState,
  reducers: {
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload
    },
    filterVideos: (state) => {
      // Filter logic can be added here
      // Currently just a simple mock
    },
  },
})

export const { setSearchQuery, filterVideos } = videoSlice.actions
export default videoSlice.reducer
