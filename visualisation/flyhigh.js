function createChart() {
  // general
  const pi2 = 2 * Math.PI;
  const pi1_2 = Math.PI / 2;
  const sf = 2;
  const lineColor = {
    high: '#EF6461',
    middle:'#E3D8F1',
    low: '#2274A5'
  };
  
  // the chart container
  let container = d3.select('#chart');

  // remove old stuff
  container.selectAll('svg, canvas').remove();
  container.style('height', null);
  
  // the window dimensions
  const ww = window.innerWidth;
  const wh = window.innerHeight;

  // defining the visual dimensions
  const baseWidth = 1600;
  const width = ww;

  const height = Math.max(wh, width / 1.5);

  const sizeFactor = width / baseWidth;

  // set the container to the calculated dimensions
  container.style('width', `${width}px`);
  container.style('height', `${height}px`);

  // create canvas for the lines
  let canvas = container.append('canvas').attr('id', 'canvas-target');
  let ctx = canvas.node().getContext('2d');

  // make the canvas nice looking
  canvas
    .attr('width', sf * width)
    .attr('height', sf * height)
    .style('width', `${width}px`)
    .style('height', `${height}px`);
  ctx.scale(sf, sf);
  ctx.translate(width / 2, height / 2);

  // general settings
  ctx.globalCompositeOperation = 'color'; // darken, lighten, color
  ctx.lineCap = 'round';


  // read in the data
  const timeParser = (datetime) => {
    return d3.utcParse('%Y-%m-%dT%I:%M:%SZ')(datetime);
  }

  let dataCatch = Promise.all([
    d3.csv('./data/flights_by_day_to_departure.csv', (d) => {
      return {
        ...d,
        price: +d.price,
        timeToDepartureDays: +d.timeToDepartureDays,
        departure: timeParser(d.departure)
      };
    }),
    d3.csv('./data/flight_info.csv', (d) => {
      return {
        ...d,
        arrival: timeParser(d.arrival),
        departure: timeParser(d.departure),
        departureRounded: timeParser(d.departureRounded),
        meanPrice: +d.meanPrice,
        medianPrice: +d.medianPrice,
        sumPrice: +d.sumPrice,
        sdPrice: +d.sdPrice,
        endPrice: isNaN(+d.endPrice) ? 0 : +d.endPrice
      };
    })
  ]);
  
  dataCatch.then(data => {
    createVisuals(data);
  });

  function createVisuals(data) {
    const radialData = data[0];
    const flightInfo = data[1];
    
    const maxPrice = d3.max(radialData, d => d.price);

    let priceScale = d3.scaleLinear()
      .domain([0, maxPrice])
      .range([width / 15, width * 0.4]);

    const nData = d3.nest()
      .key(d => d.flightIdUnique)
      .entries(radialData);

    const radialDataPreCalc = nData.map(priceLine => {
      let priceLineData = [];
      priceLine.values.forEach(d => {
        const angle = -pi2 * (d.timeToDepartureDays - 1) / (30 * 1.15);
        const point = {
          day: d.timeToDepartureDays,
          radius: priceScale(d.price),
          angle: angle,
          x: (0.5 + Math.cos(angle - pi1_2) * priceScale(d.price)) << 0,
          y: (0.5 + Math.sin(angle - pi1_2) * priceScale(d.price)) << 0
        };
        priceLineData.push(point);
      });

      const minRadius = Math.min(...priceLineData.map(elem => elem.radius));
      const maxRadius = Math.max(...priceLineData.map(elem => elem.radius));
      const endRadius = priceLineData.filter(v => v.day === 1)[0].radius;
      const middleStop = Math.min((endRadius - minRadius) / (maxRadius - minRadius), 1.0);

      let color;
      if (maxRadius - minRadius <= 0.0) {
        color = '#E3D8F1';
      } else {
        color = ctx.createRadialGradient(0, 0, minRadius, 0, 0, maxRadius);
        color.addColorStop(0, lineColor.low);
        color.addColorStop(middleStop, lineColor.middle);
        color.addColorStop(1, lineColor.high);
      }

      return {
        priceLineData,
        minRadius,
        maxRadius,
        endRadius,
        middleStop,
        color,
        departure: priceLine.values[0].departure
      };
    });

    drawTimeBrush(flightInfo, radialDataPreCalc);

    function drawCanvas(data) {
      ctx.clearRect(-width / 2, -height / 2, width, height);
      ctx.globalAlpha = 0.6;

      data.forEach(d => {
        ctx.beginPath();
        d.priceLineData.forEach((point, index) => {
          ctx.lineTo(point.x, point.y);
        })
        ctx.lineWidth = 3 * sizeFactor;
        ctx.strokeStyle = d.color;
        ctx.stroke();
      });
    }

    function drawTimeBrush(flightInfo, radialData) {
      const formatTime = d3.timeFormat('%Y-%m-%d');
      const radialDataIndex = radialData.map(d => {
        return formatTime(d.departure);
      });

      const brushHeight = 100;
      let svg = container.append('svg').lower()
        .attr('id','departure-brush')
        .attr('width', width)
        .attr('height', brushHeight);

      let graph = svg.append('g');

      let x = d3.scaleTime()
        .domain(d3.extent(flightInfo, d => d.departure))
        .range([0, width]);

      let yGenerator = (category) => d3.scaleLinear()
        .domain([0, d3.max(flightInfo, d => d[category])])
        .range([brushHeight, 0]);
      
      const area = (category) => d3.area()
        .x(d => x(d.departure))
        .y0(yGenerator(category)(0))
        .y1(d => yGenerator(category)(d[category]))
        .curve(d3.curveBasis)

        graph.selectAll('.path-end-price')
          .data([flightInfo])
          .enter().append('path')
          .attr('d', area('endPrice'))
          .attr('fill', lineColor.middle)
          .attr('fill-opacity', 1);

        const brush = d3.brushX()
          .extent([[0, 0], [width, brushHeight]])
          .on('brush end', brushed);

        svg.append('g')
        .attr('class', 'brush')
        .call(brush)
        .call(brush.move,
          [x(timeParser('2019-06-01T00:00:00Z')),
          x(timeParser('2019-06-08T00:00:00Z'))]);

        function brushed() {
          const selectionX = d3.event.selection;
          const selectionTime = selectionX.map(elem => x.invert(elem)).map(elem => formatTime(elem));
          const start = radialDataIndex.indexOf(selectionTime[0]);
          const stop = radialDataIndex.lastIndexOf(selectionTime[1]);
          if (Math.abs(stop - start) <= 60 || d3.event.type === 'end') {
            drawCanvas(radialData.slice(start, stop + 1));
          }
        }
    }
  }
}