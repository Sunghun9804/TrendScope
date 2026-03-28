import logging


logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s: [%(name)s] %(message)s -%(asctime)s",
    datefmt="%H:%M:%S",
)


class Logger:
    def get_logger(self, name: str) -> logging.Logger:
        return logging.getLogger(name)
