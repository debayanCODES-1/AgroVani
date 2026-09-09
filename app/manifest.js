export default function manifest() {
  return {
    name: 'AgroVani AI Farm Companion',
    short_name: 'AgroVani',
    description: 'Voice and text crop advice for Indian farmers.',
    start_url: '/farmer/dashboard',
    display: 'standalone',
    background_color: '#f0f5f4',
    theme_color: '#006a42',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
    ],
  }
}