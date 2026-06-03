// @ts-nocheck
export const renderBulletSlide = (
  pptx,
  slide,
  slideData,
  COLORS,
  FONTS
) => {

  let currentY = 2;

  if (slideData.image) {

  slide.addImage({
    path: slideData.image,

    x: 0.6,
    y: 2,
    w: 3.2,
    h: 3,
  });

}

  slideData.bullets.forEach((point) => {

    // white card
    slide.addShape(
      pptx.ShapeType.roundRect,
      {
        x: 4.2,
        y: currentY,
        w: 6,
        h: 0.55,

        rectRadius: 0.05,

        fill: {
          color: "FFFFFF",
        },

        line: {
          color: COLORS.border,
          pt: 1,
        },

        shadow: {
          type: "outer",
          color: "999999",
          blur: 1,
          angle: 45,
          distance: 1,
          opacity: 0.08,
        },
      }
    );

    // accent bar
    slide.addShape(
      pptx.ShapeType.rect,
      {
        x: 1,
        y: currentY,
        w: 0.12,
        h: 0.55,

        fill: {
          color: COLORS.primary,
        },

        line: {
          color: COLORS.primary,
        },
      }
    );

    // text
    slide.addText(String(point), {
      x: 4.5,
      y: currentY + 0.15,
      w: 8.8,
      h: 0.2,

      fontSize: 16,

      color: COLORS.text,

      fontFace: FONTS.body,
    });

    currentY += 0.8;

  });

};
