export default defineNuxtPlugin(() => {
  const style = document.createElement('style')
  style.dataset.exhibitArtwork = 'hsinchu-city-hall-official-photo'
  style.textContent = `
    .hero-artwork {
      background-image:
        linear-gradient(90deg, rgba(4, 13, 21, 0.99) 0%, rgba(4, 13, 21, 0.86) 38%, rgba(4, 13, 21, 0.16) 100%),
        linear-gradient(180deg, rgba(4, 13, 21, 0.05), rgba(4, 13, 21, 0.62)),
        url('/city-hall-photo-1.jpg') !important;
      background-position: center center;
      background-size: cover;
    }

    .hero-artwork::before {
      position: absolute;
      right: 24px;
      bottom: 18px;
      z-index: 2;
      padding: 7px 10px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 7px;
      background: rgba(2, 8, 13, 0.68);
      color: rgba(225, 240, 242, 0.72);
      content: '主視覺影像：新竹市政府行政處';
      font-size: 9px;
      letter-spacing: 0.08em;
      backdrop-filter: blur(10px);
    }
  `
  document.head.appendChild(style)
})
