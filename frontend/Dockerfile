FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 5173

# Vite dev server bound to 0.0.0.0 so Docker can expose it
CMD ["npm", "run", "dev"]
