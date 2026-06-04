FROM node:22-alpine3.23

WORKDIR /backend

COPY ./package*.json ./

RUN npm install

COPY . .

EXPOSE 5000

CMD ["npm", "start"]