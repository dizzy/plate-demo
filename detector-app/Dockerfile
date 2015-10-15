FROM node

ADD . /home/detector

WORKDIR /home/detector

RUN npm install npm -g && npm install

EXPOSE 8080
CMD ["npm", "start"]
