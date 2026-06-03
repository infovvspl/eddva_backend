// @ts-nocheck
export const renderCardsSlide = (
  pptx,
  slide,
  slideData,
  COLORS
) => {

  const cards =
    slideData.cards || [];

  let startX = 0.6;

  cards.forEach((card) => {

    /*
    ==========================================
    CARD CONTAINER
    ==========================================
    */

    slide.addShape(
      pptx.ShapeType.roundRect,
      {
        x: startX,
        y: 1.8,
        w: 2.9,
        h: 3.8,

        rectRadius: 0.06,

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
          opacity: 0.1,
        },
      }
    );

    /*
    ==========================================
    IMAGE
    ==========================================
    */

    if (card.image) {

      slide.addImage({
        path: card.image,

        x: startX + 0.1,
        y: 1.9,

        w: 2.7,
        h: 1.4,
      });

    }

    /*
    ==========================================
    TITLE
    ==========================================
    */

    slide.addText(card.title, {
      x: startX + 0.2,
      y: 3.45,
      w: 2.4,
      h: 0.4,

      fontSize: 15,
      bold: true,

      align: "center",

      color: COLORS.primary,
    });

    /*
    ==========================================
    DESCRIPTION
    ==========================================
    */

    slide.addText(card.text, {
      x: startX + 0.2,
      y: 4.0,
      w: 2.4,
      h: 1,

      fontSize: 10,

      align: "center",

      color: COLORS.text,
    });

    startX += 3.15;

  });

};
