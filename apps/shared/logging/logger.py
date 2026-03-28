import logging
class Logger:
    logging.basicConfig(
        level=logging.INFO,
        format='%(levelname)s: [%(filename)s] %(message)s - %(asctime)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )
    def get_logger(self,name):
        return logging.getLogger(name)