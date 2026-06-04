// @ts-nocheck
export const renderTimelineLayout =
(
  pptx,
  slide,
  data,
  COLORS,
  FONTS
) => {

  /*
  ==========================================
  TIMELINE LINE
  ==========================================
  */

  slide.addShape(
    pptx.ShapeType.line,
    {
      x: 1,
      y: 3,
      w: 10,
      h: 0,

      line: {
        color: COLORS.primary,
        pt: 2,
      },
    }
  );

  /*
  ==========================================
  EVENTS
  ==========================================
  */

  const events =
    data.events || [];

  const spacing =
    10 / events.length;

  events.forEach(
    (event, index) => {

      const posX =
        1 + (index * spacing);

      /*
      DOT
      */

      slide.addShape(
        pptx.ShapeType.ellipse,
        {
          x: posX,
          y: 2.85,
          w: 0.22,
          h: 0.22,

          fill: {
            color: COLORS.primary,
          },

          line: {
            color: COLORS.primary,
          },
        }
      );

      /*
      YEAR
      */

      if (event.image) {

  slide.addImage({
    path: event.image,

    x: posX - 0.35,
    y: 1.8,
    w: 0.7,
    h: 0.7,
  });

}

      slide.addText(
        event.year || "",
        {
          x: posX - 0.3,
          y: 3.2,
          w: 0.8,
          h: 0.3,

          fontSize: 11,
          bold: true,

          align: "center",

          color: COLORS.secondary,

          fontFace:
            FONTS.heading,
        }
      );

      /*
      DESCRIPTION
      */

      slide.addText(
        event.description || "",
        {
          x: posX - 0.6,
          y: 3.6,
          w: 1.3,
          h: 1,

          fontSize: 9,

          align: "center",

          color: COLORS.text,

          fontFace:
            FONTS.body,
        }
      );

    }
  );

};
