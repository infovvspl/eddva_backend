// @ts-nocheck
export const renderComparisonSlide = (
  pptx,
  slide,
  slideData,
  COLORS
) => {

  const left = slideData.left;
  const right = slideData.right;

  if (left.image) {

  slide.addImage({
    path: left.image,

    x: 2,
    y: 2.6,
    w: 2,
    h: 1.2,
  });

}

if (right.image) {

  slide.addImage({
    path: right.image,

    x: 8,
    y: 2.6,
    w: 2,
    h: 1.2,
  });

}

  // LEFT BOX
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1,
    y: 2,
    w: 4,
    h: 3,
    rectRadius: 0.08,
    fill: {
      color: COLORS.info,
    },
    line: {
      color: "93C5FD",
      pt: 1,
    },
  });

  slide.addText(left.title, {
    x: 1.5,
    y: 2.2,
    w: 3,
    h: 0.4,
    fontSize: 20,
    bold: true,
    align: "center",
    color: COLORS.primary,
  });

  let leftY = 4;

  left.points.forEach((point) => {
    slide.addText(`• ${point}`, {
      x: 1.4,
      y: leftY,
      w: 3,
      h: 0.3,
      fontSize: 15,
      color: COLORS.text,
    });

    leftY += 0.45;
  });

  // RIGHT BOX
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 7,
    y: 2,
    w: 4,
    h: 3,
    rectRadius: 0.08,
    fill: {
      color: COLORS.success,
    },
    line: {
      color: "86EFAC",
      pt: 1,
    },
  });

  slide.addText(right.title, {
    x: 7.5,
    y: 2.2,
    w: 3,
    h: 0.4,
    fontSize: 20,
    bold: true,
    align: "center",
    color: "166534",
  });

  let rightY = 4;

  right.points.forEach((point) => {
    slide.addText(`• ${point}`, {
      x: 7.4,
      y: rightY,
      w: 3,
      h: 0.3,
      fontSize: 15,
      color: COLORS.text,
    });

    rightY += 0.45;
  });

};
